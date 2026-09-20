// MessagesController — the web port of flutter/lib/messages.dart (Svelte 5
// runes). Local-first boot (sqlite mirror) → incremental sync (tip anchor) →
// one long-lived watchSession stream per active session with exponential
// backoff reconnect, eid dedup and run boundaries.
import type { AgentApi } from './api'
import type { LocalStore } from './db'
import type { StreamEvent } from './events'
import type { ChatMessage, ChatPart, Message, ToolState, UploadedFile } from './models'

type SessionListener = (event: string, params: Record<string, unknown>) => void

export function mapMessagesToChat(msgs: Message[]): ChatMessage[] {
  return msgs.map((m, i) => ({
    id: m.id,
    role: m.role,
    status: 'complete' as const,
    createdAt: m.createdAt ?? '',
    seq: i,
    isLocal: false,
    prevId: m.prevId,
    parts: m.parts.map(p => ({
      id: p.id || `p${Date.now()}${i}`,
      type: p.type,
      text: p.text ?? '',
      tool: p.tool ?? '',
      state: p.state ?? null,
      code: p.code ?? null,
      name: p.name ?? null,
      mime: p.mime ?? null,
      size: p.size ?? null,
      width: p.width ?? null,
      height: p.height ?? null,
      durationMs: p.durationMs ?? null,
      thumbCode: p.thumbCode ?? null,
      thumbhash: p.thumbhash ?? null,
    })),
  }))
}

function compareMessages(a: ChatMessage, b: ChatMessage): number {
  const at = a.seq ?? 1 << 30
  const bt = b.seq ?? 1 << 30
  if (at !== bt) return at - bt
  const apt = Date.parse(a.createdAt || '') || 0
  const bpt = Date.parse(b.createdAt || '') || 0
  if (apt && bpt && apt !== bpt) return apt - bpt
  return 0
}

export class MessagesController {
  private api: AgentApi
  private getSessionId: () => string
  private local: LocalStore | null

  messages = $state<ChatMessage[]>([])
  sending = $state(false)
  loading = $state(false)
  hasMore = $state(false)

  /** Bumped after every mutation so the UI can react via $effect. */
  revision = $state(0)

  private syncedTipId = ''
  private syncedOldestId = ''

  private streamAbort: AbortController | null = null
  private streamingId: string | null = null
  /** Local ERROR bubbles are not server chain members; keep them across
   *  authoritative refreshes (mergeServer/fetchMessages) instead of dropping
   *  them. Cleared per session in init. */
  private localErrors: ChatMessage[] = []
  private nextSeq = 1_000_000
  private sessionListeners: SessionListener[] = []

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private subSid: string | null = null

  private seenEids = new Set<string>()
  private activeRunId: string | null = null
  private awaitingRun = false

  private static MAX_RECONNECT = 10
  private static INITIAL_RECONNECT = 1000
  private static MAX_RECONNECT_MS = 30_000
  private static IDLE_PROBE_EVERY = 30_000
  private idleProbeTimer: ReturnType<typeof setInterval> | null = null
  private lastActivity = Date.now()

  private sendFailedMsg = (e: unknown): string => `send failed: ${e}`

  constructor(api: AgentApi, getSessionId: () => string, local: LocalStore | null, opts?: { sendFailed?: (e: unknown) => string }) {
    this.api = api
    this.getSessionId = getSessionId
    this.local = local
    if (opts?.sendFailed) this.sendFailedMsg = opts.sendFailed
  }

  get sorted(): ChatMessage[] {
    return [...this.messages].sort(compareMessages)
  }

  onSessionEvent(cb: SessionListener): () => void {
    this.sessionListeners.push(cb)
    return () => {
      this.sessionListeners = this.sessionListeners.filter(x => x !== cb)
    }
  }

  private allocSeq(): number {
    return this.nextSeq++
  }

  private notify() {
    this.revision++
  }

  /** Only the LOCAL bubbles still in flight. */
  private inFlightLocal(): ChatMessage[] {
    return this.messages.filter(m => m.isLocal && (m.status === 'streaming' || m.status === 'pending'))
  }

  private bumpSeqAfter(history: ChatMessage[]) {
    let maxSeq = -1
    for (const m of history) {
      if (m.seq != null && m.seq < this.nextSeq && m.seq > maxSeq) maxSeq = m.seq
    }
    if (maxSeq >= 0) this.nextSeq = maxSeq + 1
  }

  init() {
    this.localErrors = []
    const sid = this.getSessionId()
    if (!sid) return
    void this.boot(sid)
  }

  private async boot(sid: string) {
    await this.hydrateFromLocal(sid)
    await this.sync(sid)
    await this.recover()
    this.connect(sid)
  }

  private async hydrateFromLocal(sid: string) {
    const l = this.local
    if (!l) return
    try {
      const cached = await l.loadMessages(sid)
      // Only trust a stored anchor when we actually hold cached messages.
      this.syncedTipId = cached.length ? await l.serverTipId(sid) : ''
      this.syncedOldestId = cached.length ? await l.oldestCachedId(sid) : ''
      if (cached.length) {
        this.messages = [...cached, ...this.inFlightLocal()]
        this.renumber()
        this.notify()
      }
    } catch {
      /* cache unreadable — fall through network-only */
    }
  }

  /** Incremental when we hold an anchor, else a baseline fetch. */
  private async sync(sid: string) {
    const l = this.local
    this.loading = this.messages.length === 0
    this.notify()
    try {
      const cacheConsistent =
        this.messages.length === 0 ||
        (this.syncedTipId !== '' &&
          this.syncedOldestId !== '' &&
          (await l?.oldestCachedId(sid)) === this.syncedOldestId)
      if (l && this.syncedTipId && cacheConsistent) {
        const r = await this.api.messagesAfter(sid, this.syncedTipId)
        if (r.resync) {
          await this.baseline(sid)
        } else if (r.messages.length === 0 && this.messages.length === 0) {
          await this.baseline(sid)
        } else {
          this.mergeServer(r.messages, r.tipId)
          await l.persistMessages(sid, this.messages, r.tipId)
        }
      } else {
        await this.baseline(sid)
      }
    } catch {
      /* offline: keep whatever the local cache showed */
    }
    this.loading = false
    this.notify()
  }

  /** Full baseline: the newest page, replacing any cached copy. */
  private async baseline(sid: string) {
    try {
      const [msgs, more] = await this.api.messages(sid, undefined, 50)
      const chat = mapMessagesToChat(msgs)
      this.messages = [...this.inFlightLocal(), ...this.localErrors, ...chat]
      this.renumber()
      this.hasMore = more
      const l = this.local
      if (l) {
        this.syncedTipId = chat.length ? chat[chat.length - 1]!.id : ''
        await l.applyServerMessages(sid, msgs, { replace: true, tipId: this.syncedTipId })
        this.syncedOldestId = await l.oldestCachedId(sid)
      }
    } catch {
      /* keep the existing cache */
    }
  }

  /** Merge a server delta into memory, keeping in-flight local bubbles. */
  private mergeServer(msgs: Message[], tipId: string) {
    const hasServer = msgs.length > 0
    const chat = mapMessagesToChat(msgs)
    const byId = new Map<string, ChatMessage>()
    for (const m of this.messages) {
      if (!m.isLocal) {
        byId.set(m.id, m)
        continue
      }
      const inFlight = m.status === 'streaming' || m.status === 'pending'
      if (!hasServer || inFlight) byId.set(`local:${m.id}`, m)
    }
    for (const m of chat) byId.set(m.id, m)
    for (const m of this.localErrors) byId.set(`local:${m.id}`, m)
    this.messages = [...byId.values()]
    this.renumber()
    this.syncedTipId = tipId
  }

  /** Assign sequential seqs in true CHAIN order. Ties on `createdAt` keep the
   *  CURRENT array order (a stable sort), so a locally-appended user bubble
   *  stays before the assistant streaming placeholder created right after it —
   *  ordering by id (`m…` vs `u…`) would wrongly put the assistant first. */
  private renumber() {
    const ordered = this.messages
      .map((m, i) => ({ m, i }))
      .sort((a, b) => {
        const at = Date.parse(a.m.createdAt || '') || 0
        const bt = Date.parse(b.m.createdAt || '') || 0
        if (at !== bt) return at - bt
        return a.i - b.i
      })
      .map(x => x.m)
    this.messages = ordered.map((m, i) => ({ ...m, seq: i }))
    this.bumpSeqAfter(this.messages)
  }

  private async fetchMessages(before?: string) {
    this.loading = true
    this.notify()
    try {
      const sid = this.getSessionId()
      const [msgs, more] = await this.api.messages(sid, before, 50)
      const chat = mapMessagesToChat(msgs)
      if (before != null) {
        const existing = new Set(this.messages.map(m => m.id))
        this.messages = [...chat.filter(m => !existing.has(m.id)), ...this.messages]
      } else {
        this.messages = [...this.inFlightLocal(), ...this.localErrors, ...chat]
      }
      this.renumber()
      this.hasMore = more
    } catch {
      /* keep current view */
    }
    this.loading = false
    this.notify()
    const l = this.local
    if (l) {
      try {
        await l.persistMessages(this.getSessionId(), this.messages, this.syncedTipId)
        this.syncedOldestId = await l.oldestCachedId(this.getSessionId())
      } catch {
        /* ignore */
      }
    }
  }

  private async recover() {
    try {
      const [status] = await this.api.state(this.getSessionId())
      if (status === 'busy' || status === 'running') {
        this.sending = true
        if (!this.messages.some(m => m.status === 'streaming')) {
          this.streamingId = `recover-${Date.now()}`
          this.messages = [
            ...this.messages,
            {
              id: this.streamingId,
              role: 'assistant',
              status: 'streaming',
              parts: [],
              createdAt: new Date().toISOString(),
              isLocal: true,
              prevId: '',
              seq: this.allocSeq(),
            },
          ]
        }
        this.notify()
      }
    } catch {
      /* offline */
    }
  }

  private connect(sid: string) {
    this.reconnectTimer && clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.streamAbort?.abort()
    const ac = new AbortController()
    this.streamAbort = ac
    this.subSid = sid
    this.reconnectAttempt = 0
    this.lastActivity = Date.now()
    this.idleProbeTimer && clearInterval(this.idleProbeTimer)
    // Run boundary: the FIRST event of the new connection resets stale
    // streaming state; replay rebuilds it cleanly.
    this.seenEids.clear()
    this.activeRunId = null
    this.awaitingRun = true
    void (async () => {
      try {
        for await (const ev of this.api.streamEvents(sid, this.syncedTipId)) {
          if (ac.signal.aborted) return
          this.handleEvent(ev)
        }
        this.onStreamClosed(sid)
      } catch {
        if (!ac.signal.aborted) this.onStreamClosed(sid)
      }
    })()
    this.startIdleProbe()
  }

  private clearStreaming() {
    this.streamingId = null
    this.activeRunId = null
    if (this.messages.some(m => m.status === 'streaming')) {
      this.messages = this.messages.filter(m => m.status !== 'streaming')
    }
  }

  private onStreamClosed(sid: string) {
    if (this.subSid != null && this.subSid !== sid) return
    this.syncIdle()
    if (sid !== this.getSessionId()) return
    if (this.reconnectAttempt >= MessagesController.MAX_RECONNECT) return
    const delay = Math.min(
      MessagesController.MAX_RECONNECT_MS,
      MessagesController.INITIAL_RECONNECT * 2 ** this.reconnectAttempt,
    )
    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(() => this.connect(sid), delay)
  }

  private startIdleProbe() {
    this.idleProbeTimer && clearInterval(this.idleProbeTimer)
    this.idleProbeTimer = setInterval(() => {
      if (Date.now() - this.lastActivity < MessagesController.IDLE_PROBE_EVERY) return
      this.api
        .state(this.getSessionId())
        .then(([st]) => {
          if (st === 'busy' || st === 'running') {
            if (!this.sending) {
              this.sending = true
              this.notify()
            }
          } else {
            this.syncIdle()
          }
        })
        .catch(() => {})
    }, MessagesController.IDLE_PROBE_EVERY)
  }

  /** Converge to idle if the stream ended without a terminal event. */
  private syncIdle() {
    if (!this.sending) return
    this.finishStreaming()
  }

  private handleEvent(ev: StreamEvent) {
    this.lastActivity = Date.now()
    // Dedup across the subscribe/replay overlap.
    if (ev.eid) {
      if (this.seenEids.has(ev.eid)) return
      this.seenEids.add(ev.eid)
      if (this.seenEids.size > 20000) this.seenEids.clear()
    }
    // Run boundary handling.
    if (this.awaitingRun) {
      this.awaitingRun = false
      this.clearStreaming()
    }
    const run = ev.runId
    if (run && run !== this.activeRunId) {
      if (this.activeRunId != null) this.clearStreaming()
      this.activeRunId = run
    }
    for (const cb of this.sessionListeners) {
      try {
        cb(ev.event, ev.params)
      } catch {
        /* listener errors are not fatal */
      }
    }
    const { event, params } = ev
    switch (event) {
      case 'start-step':
      case 'text-start':
      case 'reasoning-start':
      case 'tool-input-start': {
        const current = this.streamingId
          ? this.messages.find(m => m.id === this.streamingId)
          : null
        const hasToolPart = current?.parts.some(p => p.type === 'tool') ?? false
        const sid = this.ensureStreamingMsg(
          event === 'start-step' || (event === 'text-start' && hasToolPart),
        )
        if (event === 'text-start' && params['id'] != null) {
          this.ensurePart(sid, params['id'] as string, 'text')
        } else if (event === 'reasoning-start' && params['id'] != null) {
          this.ensurePart(sid, `r${params['id']}`, 'reasoning')
        } else if (event === 'tool-input-start' && params['id'] != null) {
          this.startToolPart(
            sid,
            params['id'] as string,
            (params['toolName'] ?? params['name'] ?? 'tool') as string,
          )
        }
        break
      }
      case 'tool-input-delta': {
        if (params['id'] != null && params['delta'] != null) {
          this.appendToolInput(params['id'] as string, String(params['delta'] ?? ''))
        }
        break
      }
      case 'text-delta':
        if (params['id'] != null && params['text'] != null) {
          const sid = this.ensureStreamingMsg(false)
          this.appendDelta(sid, params['id'] as string, String(params['text'] ?? ''), false)
        }
        break
      case 'reasoning-delta':
        if (params['id'] != null && params['text'] != null) {
          const sid = this.ensureStreamingMsg(false)
          this.appendDelta(sid, `r${params['id']}`, String(params['text'] ?? ''), true)
        }
        break
      case 'tool-call': {
        const sid = this.ensureStreamingMsg(false)
        const tcId = (params['toolCallId'] ?? params['id']) as string | undefined
        if (tcId != null) {
          this.addToolPart(
            sid,
            tcId,
            (params['toolName'] ?? params['name'] ?? 'tool') as string,
            params['input'],
          )
        }
        break
      }
      case 'tool-result': {
        const tcId = (params['toolCallId'] ?? params['id']) as string | undefined
        if (tcId == null) break
        this.updateToolResult(tcId, params['formatted'] ?? params['output'] ?? params['result'], {
          errorMsg: undefined,
          changeId: params['change_id'] as string | undefined,
          diff: params['diff'] as string | undefined,
          additions: params['additions'] as number | undefined,
          deletions: params['deletions'] as number | undefined,
          data: (params['data'] as Record<string, unknown>) ?? undefined,
        })
        break
      }
      case 'tool-error': {
        const tcId = (params['toolCallId'] ?? params['id']) as string | undefined
        const errObj = params['error']
        const errMsg = (
          typeof errObj === 'string'
            ? errObj
            : errObj && typeof errObj === 'object'
              ? ((errObj as Record<string, unknown>)['message'] ?? params['message'] ?? 'tool error')
              : (params['message'] ?? 'tool error')
        ) as string
        if (tcId != null) this.updateToolResult(tcId, null, { errorMsg: errMsg })
        break
      }
      case 'tool-output-denied': {
        const tcId = (params['toolCallId'] ?? params['id']) as string | undefined
        if (tcId != null) this.updateToolResult(tcId, null, { errorMsg: 'denied' })
        break
      }
      case 'file':
      case 'reasoning-file': {
        // A streamed media part the agent has already offloaded to the blob
        // store; `code` is the file:<code> segment. Render it as a file part
        // (same path as persisted file parts). Both `file` and
        // `reasoning-file` are shown.
        const code = params['code'] as string | undefined
        if (code == null || code === '') break
        const sid = this.ensureStreamingMsg(false)
        const partId = `f${code}`
        const existing = this.messages
          .find(m => m.id === sid)
          ?.parts.some(p => p.id === partId)
        if (!existing) {
          this.setMsg(sid, m => ({
            ...m,
            parts: [
              ...m.parts,
              {
                id: partId,
                type: 'file',
                text: '',
                tool: '',
                code,
                name: (params['name'] as string | undefined) ?? null,
                mime: (params['mediaType'] as string | undefined) ?? null,
                size:
                  params['size'] != null ? Number(params['size']) : null,
                width:
                  params['width'] != null ? Number(params['width']) : null,
                height:
                  params['height'] != null ? Number(params['height']) : null,
                durationMs:
                  params['durationMs'] != null
                    ? Number(params['durationMs'])
                    : params['duration_ms'] != null
                      ? Number(params['duration_ms'])
                      : null,
                thumbCode:
                  (params['thumbCode'] as string | undefined) ??
                  (params['thumb_code'] as string | undefined) ??
                  null,
                thumbhash: (params['thumbhash'] as string | undefined) ?? null,
              },
            ],
          }))
        }
        break
      }
      case 'turn-complete':
        this.finishStreaming()
        break
      case 'chain-changed':
        this.clearStreaming()
        this.sending = false
        this.notify()
        void this.fetchMessages()
        break
      case 'status': {
        const stype = params['type']
        if (stype === 'busy' || stype === 'running') {
          this.sending = true
          this.notify()
        } else {
          this.finishStreaming()
        }
        break
      }
      case 'error':
      case 'provider-error': {
        const errObj = params['error']
        const content = (
          typeof errObj === 'string'
            ? errObj
            : errObj && typeof errObj === 'object'
              ? ((errObj as Record<string, unknown>)['message'] ?? params['message'] ?? 'Unknown error')
              : (params['message'] ?? 'Unknown error')
        ) as string
        this.addError(content)
        this.sending = false
        this.notify()
        break
      }
      default:
        break
    }
  }

  private ensureStreamingMsg(forceNew: boolean): string {
    if (this.streamingId) {
      const existing = this.messages.find(m => m.id === this.streamingId)
      if (existing && (!forceNew || existing.parts.length === 0)) return this.streamingId
    }
    const id = `m${Date.now()}`
    this.streamingId = id
    this.messages = [
      ...this.messages,
      {
        id,
        role: 'assistant',
        status: 'streaming',
        parts: [],
        createdAt: new Date().toISOString(),
        isLocal: true,
        prevId: '',
        seq: this.allocSeq(),
      },
    ]
    return id
  }

  private setMsg(id: string, fn: (m: ChatMessage) => ChatMessage) {
    const idx = this.messages.findIndex(m => m.id === id)
    if (idx < 0) return
    this.messages[idx] = fn(this.messages[idx]!)
    this.notify()
  }

  private ensurePart(msgId: string, partId: string, type: string) {
    this.setMsg(msgId, m =>
      m.parts.some(p => p.id === partId)
        ? m
        : { ...m, parts: [...m.parts, { id: partId, type, text: '', tool: '' }] },
    )
  }

  private appendDelta(msgId: string, partId: string, delta: string, reasoning: boolean) {
    this.setMsg(msgId, m => {
      const pidx = m.parts.findIndex(p => p.id === partId)
      const parts = [...m.parts]
      if (pidx >= 0) {
        parts[pidx] = { ...parts[pidx]!, text: parts[pidx]!.text + delta }
      } else {
        parts.push({ id: partId, type: reasoning ? 'reasoning' : 'text', text: delta, tool: '' })
      }
      return { ...m, parts }
    })
  }

  /** Create the tool part as soon as argument streaming begins. */
  private startToolPart(msgId: string, partId: string, name: string) {
    this.setMsg(msgId, m => {
      if (m.parts.some(p => p.id === partId)) return m
      const state: ToolState = { status: 'running', title: name, inputText: '' }
      const part: ChatPart = { id: partId, type: 'tool', text: '', tool: name, state }
      return { ...m, parts: [...m.parts, part] }
    })
  }

  /** Accumulate streamed tool-argument JSON for the live preview. */
  private appendToolInput(partId: string, delta: string) {
    const sid = this.streamingId
    if (!sid) return
    this.setMsg(sid, m => {
      const parts = m.parts.map(p => {
        if (p.id !== partId) return p
        const old: ToolState = p.state ?? { status: '', title: '' }
        return { ...p, state: { ...old, inputText: (old.inputText ?? '') + delta } }
      })
      return { ...m, parts }
    })
  }

  private addToolPart(msgId: string, partId: string, name: string, input: unknown) {
    const asMap =
      input && typeof input === 'object' && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : null
    const state: ToolState = { status: 'running', title: name, input: asMap }
    this.setMsg(msgId, m => {
      const pidx = m.parts.findIndex(p => p.id === partId)
      const parts = [...m.parts]
      const part: ChatPart = { id: partId, type: 'tool', text: '', tool: name, state }
      if (pidx >= 0) parts[pidx] = part
      else parts.push(part)
      return { ...m, parts }
    })
  }

  private updateToolResult(
    partId: string,
    result: unknown,
    extra: {
      errorMsg?: string
      changeId?: string
      diff?: string
      additions?: number
      deletions?: number
      data?: Record<string, unknown>
    } = {},
  ) {
    const sid = this.streamingId
    if (!sid) return
    this.setMsg(sid, m => {
      const parts = m.parts.map(p => {
        if (p.id !== partId) return p
        const old = p.state ?? { status: '', title: '' }
        const output =
          typeof result === 'string' ? result : result == null ? null : pretty(result)
        return {
          ...p,
          state: {
            status: extra.errorMsg != null ? 'error' : 'complete',
            title: old.title,
            error: extra.errorMsg ?? old.error ?? null,
            input: old.input ?? null,
            output: output ?? old.output ?? null,
            data: extra.data ?? old.data ?? null,
            changeId: extra.changeId ?? old.changeId ?? null,
            diff: extra.diff ?? old.diff ?? null,
            additions: extra.additions ?? old.additions ?? null,
            deletions: extra.deletions ?? old.deletions ?? null,
          } satisfies ToolState,
        }
      })
      return { ...m, parts }
    })
  }

  private finishStreaming() {
    this.messages = this.messages.map(m =>
      m.status === 'streaming' ? { ...m, status: 'complete' as const } : m,
    )
    this.streamingId = null
    this.activeRunId = null
    this.sending = false
    this.notify()
    void this.reconcile()
  }

  /** After a turn completes, pull the server delta and adopt real ids. */
  private async reconcile() {
    const l = this.local
    if (!l) return
    const sid = this.getSessionId()
    try {
      if (!this.syncedTipId) {
        await this.baseline(sid)
        return
      }
      const r = await this.api.messagesAfter(sid, this.syncedTipId)
      if (r.resync) {
        await this.baseline(sid)
        return
      }
      this.mergeServer(r.messages, r.tipId)
      this.notify()
      await l.persistMessages(sid, this.messages, this.syncedTipId)
      this.syncedOldestId = await l.oldestCachedId(sid)
    } catch {
      /* offline reconcile retry on next turn */
    }
  }

  private addError(text: string) {
    const now = Date.now()
    const err = {
      id: `err${now}`,
      role: 'error',
      status: 'error' as const,
      isLocal: true,
      parts: [{ id: `p${now}`, type: 'text' as const, text, tool: '' }],
      createdAt: new Date().toISOString(),
      prevId: '',
      seq: this.allocSeq(),
    }
    this.localErrors.push(err)
    this.messages = [
      ...this.messages.filter(m => m.status !== 'streaming'),
      err,
    ]
    this.streamingId = null
  }

  async send(text: string, attachments: UploadedFile[] = []) {
    const trimmed = text.trim()
    if ((!trimmed && !attachments.length) || this.sending) return
    this.sending = true
    const codes = attachments.map(a => a.code)
    const now = Date.now()
    const userParts: ChatPart[] = [
      ...attachments.map(a => ({
        id: `f${a.code}`,
        type: 'file',
        text: '',
        tool: '',
        code: a.code,
        name: a.name ?? null,
        mime: a.mime ?? null,
        size: a.size ?? null,
      })),
      ...(trimmed
        ? [{ id: `p${now}`, type: 'text', text: trimmed, tool: '' }]
        : []),
    ]
    this.messages = [
      ...this.messages.filter(m => m.status !== 'streaming'),
      {
        id: `u${now}`,
        role: 'user',
        status: 'pending',
        isLocal: true,
        parts: userParts,
        createdAt: new Date().toISOString(),
        prevId: '',
        seq: this.allocSeq(),
      },
    ]
    this.ensureStreamingMsg(true)
    this.notify()
    try {
      const messageId = await this.api.prompt(this.getSessionId(), trimmed, codes)
      if (messageId) {
        this.messages = this.messages.map(m =>
          m.status === 'pending' && m.role === 'user' && m.isLocal
            ? { ...m, id: messageId, status: 'complete' as const, isLocal: false }
            : m,
        )
        this.notify()
      }
    } catch (e) {
      this.addError(this.sendFailedMsg(e))
      this.sending = false
      this.notify()
    }
  }

  stop() {
    void this.api.interrupt(this.getSessionId()).then(() => this.finishStreaming())
  }

  async revert(messageId: string) {
    if (this.sending) {
      await this.api.interrupt(this.getSessionId())
    }
    await this.api.revert(this.getSessionId(), messageId)
    this.clearStreaming()
    this.sending = false
    await this.fetchMessages()
  }

  /** Retry/Edit: withdraw a user message and everything after, then resend. */
  async resendFrom(msg: ChatMessage, text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    if (this.sending) {
      await this.api.interrupt(this.getSessionId())
    }
    const codes = msg.parts
      .filter(p => p.type === 'file')
      .map(p => p.code ?? '')
      .filter(c => !!c)
    await this.api.revert(this.getSessionId(), msg.id)
    this.clearStreaming()
    this.sending = false
    await this.fetchMessages()
    await this.send(trimmed, codes.map(code => ({ code, name: null, mime: null } as UploadedFile)))
  }

  async loadMore() {
    if (!this.hasMore || this.loading) return
    const first = this.sorted[0]
    if (!first) return
    await this.fetchMessages(first.id)
  }

  dispose() {
    this.reconnectTimer && clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.idleProbeTimer && clearInterval(this.idleProbeTimer)
    this.idleProbeTimer = null
    this.streamAbort?.abort()
    this.streamAbort = null
  }
}

function pretty(o: unknown): string {
  if (typeof o === 'object' && o != null) return JSON.stringify(o, null, 2)
  return String(o)
}

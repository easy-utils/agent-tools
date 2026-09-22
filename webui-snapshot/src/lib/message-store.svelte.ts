// MessageStore — the reactive message list and every low-level content
// mutation (bubbles, parts, streamed tool calls). It owns no transport: the
// MessagesController drives it, feeding server rows / stream events in and
// reading `messages`/`sorted` out. Split out of messages.svelte.ts so the
// controller file stays about connection, sync and mailbox concerns.

import { mapMessagesToChat } from './message-mapping'
import { compareMessages, orderMessages } from './message-order'
import {
  addToolPartIn,
  appendDeltaTo,
  appendToolInputTo,
  applyToolResultTo,
  ensurePartIn,
  startToolPartIn,
  type ToolResultExtra,
} from './message-parts'
import type { ChatMessage, Message } from './models'

export class MessageStore {
  messages = $state<ChatMessage[]>([])
  sending = $state(false)
  loading = $state(false)
  hasMore = $state(false)

  /** PENDING (unconsumed) mailbox entries for the open session — drives the
   *  red badge on the top-bar mailbox button. */
  pendingMailbox = $state(0)

  /** Bumped after every mutation so the UI can react via $effect. */
  revision = $state(0)

  /** True while a send RPC is in flight (from submit to `accepted`). Drives the
   *  composer spinner only; the user bubble itself comes from the server's
   *  `message-added` event. */
  awaitingSend = $state(false)

  /** Server-authored id of a message whose streaming step is in flight. The
   *  delta router reads this; `message-added{streaming:true}` sets it, and a
   *  new step (or turn end) replaces/clears it. */
  streamingId: string | null = null

  /** Local ERROR bubbles are not server chain members; keep them across
   *  authoritative refreshes instead of dropping them. */
  private localErrors: ChatMessage[] = []
  private nextSeq = 1_000_000

  get sorted(): ChatMessage[] {
    return [...this.messages].sort(compareMessages)
  }

  allocSeq(): number {
    return this.nextSeq++
  }

  notify() {
    this.revision++
  }

  /** Reset per-session local state (error bubbles). */
  reset() {
    this.localErrors = []
  }

  /** Drop every local error bubble. Called when the user sends a new prompt:
   *  an error is a TRANSIENT state, cleared by the next send (not only by a
   *  successful turn). */
  clearErrors() {
    if (this.localErrors.length === 0) return
    this.localErrors = []
    this.messages = this.messages.filter(m => m.role !== 'error')
    this.notify()
  }

  /** The local (non-chain) error bubbles, for re-seeding after a refresh. */
  get errors(): readonly ChatMessage[] {
    return this.localErrors
  }

  /** Only the LOCAL bubbles still in flight. */
  inFlightLocal(): ChatMessage[] {
    return this.messages.filter(
      m => m.isLocal && (m.status === 'streaming' || m.status === 'sending'),
    )
  }

  private bumpSeqAfter(history: ChatMessage[]) {
    let maxSeq = -1
    for (const m of history) {
      if (m.seq != null && m.seq < this.nextSeq && m.seq > maxSeq)
        maxSeq = m.seq
    }
    if (maxSeq >= 0) this.nextSeq = maxSeq + 1
  }

  /** Re-seat `seq` from the authoritative ordering (see [orderMessages]). */
  renumber() {
    this.messages = orderMessages(this.messages)
    this.bumpSeqAfter(this.messages)
  }

  /** Merge a server delta into memory. ASSISTANT messages are server-authored
   *  (id and `prev_id` come from `message-added`), so a delta is an in-place
   *  update by id — no client-side id invention, no anchor guessing. Local
   *  error bubbles and the in-flight streamed bubble are preserved. */
  mergeServer(msgs: Message[]) {
    const chat = mapMessagesToChat(msgs)
    // Preserve: local error bubbles, and the LIVE streamed bubble (the server
    // copy of a step only lands AFTER its stream ends; until then the local
    // streaming row is the only copy and must survive the merge).
    const streaming =
      this.messages.find(m => m.isLocal && m.id === this.streamingId) ?? null
    const byId = new Map<string, ChatMessage>()
    for (const m of this.messages) {
      if (m.isLocal) continue
      byId.set(m.id, m)
    }
    for (const m of chat) byId.set(m.id, m)
    if (streaming !== null && !byId.has(streaming.id))
      byId.set(streaming.id, streaming)
    for (const m of this.localErrors) byId.set(`err:${m.id}`, m)
    // Once the server holds the live step's id, the stream is over and the
    // server row supersedes our local copy (drop the flag).
    if (this.streamingId != null && byId.has(this.streamingId)) {
      const s = byId.get(this.streamingId)!
      if (!s.isLocal) this.streamingId = null
    }
    this.messages = [...byId.values()]
    this.renumber()
  }

  /** Ensure a streamed assistant bubble exists under the SERVER-authored id.
   *  No id is minted here; `id` comes from `message-added`/the delta's
   *  `message_id`, and `prevId` is the server's `prev_id` (known at step
   *  start). Reuses the existing bubble if present (a delta may arrive before
   *  the formal `message-added{streaming:true}` on replay).
   *
   *  Returns the id, or null when the target is a PERSISTED (non-local) step —
   *  i.e. a replay of a finished step; callers must skip the mutation. */
  ensureStreamingMsg(id: string, prevId?: string): string | null {
    const existing = this.messages.find(m => m.id === id)
    if (existing) {
      if (!existing.isLocal) return null // persisted step: replay duplicate
      if (existing.status === 'streaming') return id
      // Was finalized by a previous step's boundary; reopen it.
      this.messages = this.messages.map(m =>
        m.id === id ? { ...m, status: 'streaming' as const } : m,
      )
      return id
    }
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
        prevId: prevId ?? '',
        source: '',
        seq: this.allocSeq(),
      },
    ]
    return id
  }

  /** Create a minimal server-authored bubble (used for a user message whose
   *  full body is fetched by the following `reconcile`). */
  upsertServerMessage(
    id: string,
    prevId: string,
    role: string,
    source = '',
  ): void {
    if (this.messages.some(m => m.id === id)) return
    this.messages = [
      ...this.messages,
      {
        id,
        role,
        status: 'complete',
        parts: [],
        createdAt: new Date().toISOString(),
        isLocal: false,
        prevId,
        source,
        seq: this.allocSeq(),
      },
    ]
  }

  /** A run ended (or a new one began): drop any still-streaming local bubble.
   *  Streamed assistant bubbles are server-authored (their id is a real server
   *  id), so if the server already holds that row `mergeServer` keeps it; an
   *  orphan (never persisted) is removed here. */
  clearStreaming() {
    if (this.streamingId != null) {
      const id = this.streamingId
      this.messages = this.messages.filter(m => !(m.isLocal && m.id === id))
      this.streamingId = null
    }
  }

  /** Mark every streaming bubble complete and leave the busy state. Returns
   *  nothing: the controller triggers reconcile/mailbox refresh afterwards. */
  finishStreaming() {
    this.messages = this.messages.map(m =>
      m.status === 'streaming' ? { ...m, status: 'complete' as const } : m,
    )
    this.streamingId = null
    this.sending = false
    this.notify()
  }

  setMsg(id: string, fn: (m: ChatMessage) => ChatMessage) {
    const idx = this.messages.findIndex(m => m.id === id)
    if (idx < 0) return
    // A PERSISTED (non-local) row is a finished step: a streamed mutation for
    // it is a reconnect replay duplicate. Dropping it here guards every stream
    // mutator (part ensure/append/tool) in one place.
    if (!this.messages[idx]!.isLocal) return
    this.messages[idx] = fn(this.messages[idx]!)
    this.notify()
  }

  ensurePart(msgId: string, partId: string, type: string) {
    this.setMsg(msgId, m => ({
      ...m,
      parts: ensurePartIn(m.parts, partId, type),
    }))
  }

  appendDelta(
    msgId: string,
    partId: string,
    delta: string,
    reasoning: boolean,
  ) {
    this.setMsg(msgId, m => ({
      ...m,
      parts: appendDeltaTo(m.parts, partId, delta, reasoning),
    }))
  }

  /** Create the tool part as soon as argument streaming begins. */
  startToolPart(msgId: string, partId: string, name: string) {
    this.setMsg(msgId, m => ({
      ...m,
      parts: startToolPartIn(m.parts, partId, name),
    }))
  }

  /** Accumulate streamed tool-argument JSON for the live preview. */
  appendToolInput(partId: string, delta: string) {
    const sid = this.streamingId
    if (!sid) return
    this.setMsg(sid, m => ({
      ...m,
      parts: appendToolInputTo(m.parts, partId, delta),
    }))
  }

  addToolPart(msgId: string, partId: string, name: string, input: unknown) {
    this.setMsg(msgId, m => ({
      ...m,
      parts: addToolPartIn(m.parts, partId, name, input),
    }))
  }

  updateToolResult(
    partId: string,
    result: unknown,
    extra: ToolResultExtra = {},
  ) {
    const sid = this.streamingId
    if (!sid) return
    this.setMsg(sid, m => ({
      ...m,
      parts: applyToolResultTo(m.parts, partId, result, extra),
    }))
  }

  addError(text: string, kind: 'send' | 'model' = 'model') {
    const now = Date.now()
    const err: ChatMessage = {
      id: `err${now}`,
      role: 'error',
      status: 'error',
      isLocal: true,
      errorKind: kind,
      parts: [{ id: `p${now}`, type: 'text' as const, text, tool: '' }],
      createdAt: new Date().toISOString(),
      prevId: '',
      source: '',
      seq: this.allocSeq(),
    }
    this.localErrors.push(err)
    this.messages = [...this.messages, err]
  }
}

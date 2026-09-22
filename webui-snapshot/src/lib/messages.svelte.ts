// MessagesController — the web port of flutter/lib/messages.dart (Svelte 5
// runes). Local-first boot (sqlite mirror) → incremental sync (tip anchor) →
// one long-lived watchSession stream per active session with exponential
// backoff reconnect, eid dedup and run boundaries.
//
// Responsibilities are split:
//   - MessageStore  (message-store.svelte.ts)  reactive list + mutations
//   - MessageSync   (message-sync.ts)          local mirror + server delta
//   - applyStreamEvent (message-events.ts)     pure event → store router
//   - SessionStream (session-stream.ts)        transport + reconnect/watchdog
//   - this class    wiring, the mailbox, and the public actions
//                   (deliver/revert/resend/stop/loadMore).
// `messages`/`sorted`/`sending`/… are re-exposed as getters so call sites are
// unchanged.
import type { AgentApi } from './api'
import { connection } from './connection.svelte'
import type { LocalStore } from './db'
import type { StreamEvent } from './events'
import { applyStreamEvent } from './message-events'
import { compareMessages, orderMessages } from './message-order'
import { MessageStore } from './message-store.svelte'
import { MessageSync } from './message-sync'
import type { ChatMessage, UploadedFile } from './models'
import { SessionStream } from './session-stream'

export { mapMessagesToChat } from './message-mapping'
export { compareMessages, orderMessages }

type SessionListener = (event: string, params: Record<string, unknown>) => void

export class MessagesController {
  private api: AgentApi
  private getSessionId: () => string

  /** Reactive message list + all content/part mutations. */
  readonly store = new MessageStore()
  /** Local-first mirror + server sync (owns the tip/oldest anchors). */
  private sync: MessageSync
  /** Live per-session transport (stream, reconnect, watchdog, idle probe). */
  private stream: SessionStream

  private sessionListeners: SessionListener[] = []

  // Body text for an error card: the card TITLE already says what failed
  // (Send failed / Model error), so the body is the raw error message.
  private sendFailedMsg = (e: unknown): string => String(e)

  constructor(
    api: AgentApi,
    getSessionId: () => string,
    local: LocalStore | null,
  ) {
    this.api = api
    this.getSessionId = getSessionId
    this.sync = new MessageSync(api, getSessionId, local, this.store)
    this.stream = new SessionStream(api, {
      getSessionId: () => this.getSessionId(),
      getSince: () => this.sync.syncedTipId,
      isSending: () => this.store.sending,
      onEvent: ev => this.handleEvent(ev),
      onRunBoundary: () => this.clearStreaming(),
      onIdle: () => this.syncIdleAndPull(),
      onStreamClosed: () => this.syncIdle(),
      onBusy: () => {
        if (!this.store.sending) {
          this.store.sending = true
          this.store.notify()
        }
      },
      onDisconnected: () => {
        connection.chat = true
      },
      onConnected: () => {
        connection.chat = false
      },
    })
  }

  // ---- reactive surface (delegated to the store) ----

  get messages(): ChatMessage[] {
    return this.store.messages
  }
  get sorted(): ChatMessage[] {
    return this.store.sorted
  }
  get sending(): boolean {
    return this.store.sending
  }
  get loading(): boolean {
    return this.store.loading
  }
  get hasMore(): boolean {
    return this.store.hasMore
  }
  get pendingMailbox(): number {
    return this.store.pendingMailbox
  }
  get revision(): number {
    return this.store.revision
  }
  get awaitingSend(): boolean {
    return this.store.awaitingSend
  }

  onSessionEvent(cb: SessionListener): () => void {
    this.sessionListeners.push(cb)
    return () => {
      this.sessionListeners = this.sessionListeners.filter(x => x !== cb)
    }
  }

  init() {
    this.store.reset()
    const sid = this.getSessionId()
    if (!sid) return
    void this.boot(sid)
  }

  private async boot(sid: string) {
    await this.sync.hydrate(sid)
    await this.sync.sync(sid)
    await this.recover()
    this.stream.connect(sid)
    void this.refreshMailbox()
  }

  /** Count the session's PENDING (unconsumed) mailbox entries for the badge.
   *  Best-effort: a transient error keeps the last known count. */
  async refreshMailbox(): Promise<void> {
    const sid = this.getSessionId()
    if (!sid) {
      this.store.pendingMailbox = 0
      return
    }
    try {
      // Newest page only: pending entries are the most recent, so the badge
      // reads correctly without paging the whole queue.
      const { entries } = await this.api.mailbox(sid)
      this.store.pendingMailbox = entries.filter(
        e => e.status !== 'consumed',
      ).length
    } catch {
      /* keep the previous count */
    }
  }

  /** Send a prompt (mailbox-only, whether the session is idle or busy).
   *
   *  The composer spins only while the send RPC is in flight; it stops as soon
   *  as the server ACCEPTS the prompt, i.e. the message is durably enqueued in
   *  the mailbox. It must NOT wait for `message-added{role:user}`: the agent
   *  only persists the row when the running turn next drains the mailbox (a
   *  step boundary), which can be minutes into a long model call or tool — the
   *  send is already complete at `accepted`. The user bubble still appears from
   *  `message-added` (server-driven id/position); never a client-optimistic
   *  row. */
  async deliver(text: string, attachments: UploadedFile[] = []): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed && !attachments.length) return
    // An error is TRANSIENT: sending a new prompt clears any prior error card,
    // regardless of whether the previous turn finished. Done BEFORE the RPC so
    // a send failure re-adds its own error below without removing it.
    this.store.clearErrors()
    const codes = attachments.map(a => a.code)
    this.store.awaitingSend = true
    this.store.notify()
    try {
      // Resolves on the server's `accepted` event = durably in the mailbox.
      await this.api.prompt(this.getSessionId(), trimmed, codes)
      this.store.awaitingSend = false
      this.store.notify()
    } catch (e) {
      this.store.addError(this.sendFailedMsg(e), 'send')
      this.store.awaitingSend = false
      this.store.notify()
      throw e
    }
  }

  private async recover() {
    // A busy session is reconstructed from the stream itself: replay delivers
    // the live step's `message-added{streaming:true}` (with its server id) plus
    // its deltas, so no client-invented placeholder is needed here.
    try {
      const [status] = await this.api.state(this.getSessionId())
      if (status === 'busy' || status === 'running') {
        this.store.sending = true
        this.store.notify()
      }
    } catch {
      /* offline */
    }
  }

  /** Drop any still-streaming local bubble and leave the active run. */
  private clearStreaming() {
    this.store.clearStreaming()
    this.stream.resetRun()
  }

  /** Converge to idle if the stream ended without a terminal event. */
  private syncIdle() {
    if (!this.store.sending) return
    this.finishStreaming()
  }

  /** Idle confirmed by a live probe: converge AND pull the missed delta. */
  private syncIdleAndPull() {
    this.syncIdle()
    void this.sync.reconcile()
  }

  private handleEvent(ev: StreamEvent) {
    for (const cb of this.sessionListeners) {
      try {
        cb(ev.event, ev.params)
      } catch {
        /* listener errors are not fatal */
      }
    }
    // Translate the event into store mutations (pure router, message-events).
    applyStreamEvent(this.store, ev.event, ev.params, {
      finishStreaming: () => this.finishStreaming(),
      refreshMailbox: () => void this.refreshMailbox(),
      reconcile: () => void this.sync.reconcile(),
      clearStreaming: () => this.clearStreaming(),
      fetchMessages: () => void this.sync.fetch(),
    })
  }

  /** Mark every streaming bubble complete, leave the busy state, and pull the
   *  authoritative delta. */
  private finishStreaming() {
    this.store.finishStreaming()
    this.stream.resetRun()
    void this.sync.reconcile()
  }

  stop() {
    void this.api
      .interrupt(this.getSessionId())
      .then(() => this.finishStreaming())
  }

  async revert(messageId: string) {
    if (this.store.sending) {
      await this.api.interrupt(this.getSessionId())
    }
    await this.api.revert(this.getSessionId(), messageId)
    this.clearStreaming()
    this.store.sending = false
    await this.sync.fetch()
  }

  /** Retry/Edit: withdraw a user message and everything after, then resend. */
  async resendFrom(msg: ChatMessage, text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    if (this.store.sending) {
      await this.api.interrupt(this.getSessionId())
    }
    const codes = msg.parts
      .filter(p => p.type === 'file')
      .map(p => p.code ?? '')
      .filter(c => !!c)
    await this.api.revert(this.getSessionId(), msg.id)
    this.clearStreaming()
    this.store.sending = false
    await this.sync.fetch()
    await this.deliver(
      trimmed,
      codes.map(code => ({ code, name: null, mime: null }) as UploadedFile),
    )
  }

  async loadMore() {
    if (!this.store.hasMore || this.store.loading) return
    const first = this.store.sorted[0]
    if (!first) return
    await this.sync.fetch(first.id)
  }

  dispose() {
    this.stream.dispose()
  }
}

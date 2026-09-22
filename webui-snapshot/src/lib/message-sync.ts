// MessageSync — everything that reconciles the reactive store with the
// authoritative server chain: local-first hydrate, incremental sync (tip
// anchor), full baseline, paged fetch and the post-turn reconcile. It owns the
// sync anchors (tip/oldest) and the local-store mirror; it knows nothing about
// the live stream (MessagesController owns that and calls in here).
import type { AgentApi } from './api'
import type { LocalStore } from './db'
import { mapMessagesToChat } from './message-mapping'
import type { MessageStore } from './message-store.svelte'

export class MessageSync {
  /** Newest server message id we hold — the stream anchor and delta cursor. */
  syncedTipId = ''
  /** Oldest cached message id, to validate the local mirror before trusting it. */
  syncedOldestId = ''

  constructor(
    private api: AgentApi,
    private getSessionId: () => string,
    private local: LocalStore | null,
    private store: MessageStore,
  ) {}

  /** Seed the store from the local mirror (best-effort; network-only on miss). */
  async hydrate(sid: string): Promise<void> {
    const l = this.local
    if (!l) return
    try {
      const cached = await l.loadMessages(sid)
      // Only trust a stored anchor when we actually hold cached messages.
      this.syncedTipId = cached.length ? await l.serverTipId(sid) : ''
      this.syncedOldestId = cached.length ? await l.oldestCachedId(sid) : ''
      if (cached.length) {
        this.store.messages = [...cached, ...this.store.inFlightLocal()]
        this.store.renumber()
        this.store.notify()
      }
    } catch {
      /* cache unreadable — fall through network-only */
    }
  }

  /** Incremental when we hold an anchor, else a baseline fetch. */
  async sync(sid: string): Promise<void> {
    const l = this.local
    this.store.loading = this.store.messages.length === 0
    this.store.notify()
    try {
      const cacheConsistent =
        this.store.messages.length === 0 ||
        (this.syncedTipId !== '' &&
          this.syncedOldestId !== '' &&
          (await l?.oldestCachedId(sid)) === this.syncedOldestId)
      if (l && this.syncedTipId && cacheConsistent) {
        const r = await this.api.messagesAfter(sid, this.syncedTipId)
        if (r.resync) {
          await this.baseline(sid)
        } else if (
          r.messages.length === 0 &&
          this.store.messages.length === 0
        ) {
          await this.baseline(sid)
        } else {
          this.store.mergeServer(r.messages)
          this.syncedTipId = r.tipId
          await l.persistMessages(sid, this.store.messages, r.tipId)
        }
      } else {
        await this.baseline(sid)
      }
    } catch {
      /* offline: keep whatever the local cache showed */
    }
    this.store.loading = false
    this.store.notify()
  }

  /** Full baseline: the newest page, replacing any cached copy. */
  async baseline(sid: string): Promise<void> {
    try {
      const [msgs, more] = await this.api.messages(sid, undefined, 50)
      const chat = mapMessagesToChat(msgs)
      this.store.messages = [
        ...this.store.inFlightLocal(),
        ...this.store.errors,
        ...chat,
      ]
      this.store.renumber()
      this.store.hasMore = more
      const l = this.local
      if (l) {
        this.syncedTipId = chat.length ? chat[chat.length - 1]!.id : ''
        await l.applyServerMessages(sid, msgs, {
          replace: true,
          tipId: this.syncedTipId,
        })
        this.syncedOldestId = await l.oldestCachedId(sid)
      }
    } catch {
      /* keep the existing cache */
    }
  }

  /** Page of older messages (load-more). */
  async fetch(before?: string): Promise<void> {
    this.store.loading = true
    this.store.notify()
    try {
      const sid = this.getSessionId()
      const [msgs, more] = await this.api.messages(sid, before, 50)
      const chat = mapMessagesToChat(msgs)
      if (before != null) {
        const existing = new Set(this.store.messages.map(m => m.id))
        this.store.messages = [
          ...chat.filter(m => !existing.has(m.id)),
          ...this.store.messages,
        ]
      } else {
        this.store.messages = [
          ...this.store.inFlightLocal(),
          ...this.store.errors,
          ...chat,
        ]
      }
      this.store.renumber()
      this.store.hasMore = more
    } catch {
      /* keep current view */
    }
    this.store.loading = false
    this.store.notify()
    const l = this.local
    if (l) {
      try {
        await l.persistMessages(
          this.getSessionId(),
          this.store.messages,
          this.syncedTipId,
        )
        this.syncedOldestId = await l.oldestCachedId(this.getSessionId())
      } catch {
        /* ignore */
      }
    }
  }

  /** After a turn completes (or a message-added nudge), pull the server delta
   *  and adopt real ids. Works without a local store: the merge is in-memory
   *  and persistence is simply skipped. */
  async reconcile(): Promise<void> {
    const l = this.local
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
      this.store.mergeServer(r.messages)
      this.syncedTipId = r.tipId
      this.store.notify()
      if (l) {
        await l.persistMessages(sid, this.store.messages, this.syncedTipId)
        this.syncedOldestId = await l.oldestCachedId(sid)
      }
    } catch {
      /* offline reconcile retry on next turn */
    }
  }
}

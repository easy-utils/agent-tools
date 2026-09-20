// AppStore — the web port of flutter/lib/store.dart (Svelte 5 runes edition).
// Owns: the session list (watchSessions live stream + reconnect backoff),
// unread read-watermarks, per-session chat drafts, provider draft, and the
// per-tab navigation stacks.
import type { AgentApi } from './api'
import type { LocalStore } from './db'
import type { ChatDraft, ProviderDraft, Session } from './models'
import { draftFromProvider, FALLBACK_API_TYPE_CAPABILITIES, type ProviderInfo } from './models'
import { Prefs } from './prefs'

export type SiderTab = 'chat' | 'config'
export type SessionOverlay = 'mailbox'

// ---- navigation model (navigation.dart) ----

export type AppPage =
  | { kind: 'chat_list'; key: 'chat_list' }
  | { kind: 'chat_session'; key: 'chat_session' }
  | { kind: 'chat_overlay'; key: 'chat_overlay'; overlay: SessionOverlay }
  | { kind: 'config_root'; key: 'config_root' }
  | { kind: 'config_sub'; key: string; id: string }
  | { kind: 'providers_list'; key: 'providers_list' }
  | { kind: 'preset_form'; key: 'preset_form_new' }
  | { kind: 'provider_form'; key: 'provider_form' }
  | { kind: 'provider_models'; key: string; modelId: string | null }

export function rootPageFor(tab: SiderTab): AppPage {
  return tab === 'chat' ? { kind: 'chat_list', key: 'chat_list' } : { kind: 'config_root', key: 'config_root' }
}

export class AppStore {
  api: AgentApi
  local: LocalStore | null

  siderTab = $state<SiderTab>('chat')
  sessions = $state<Session[]>([])
  activeSessionId = $state<string | null>(null)
  sessionOverlay = $state<SessionOverlay | null>(null)

  sessionRevision = $state(0)
  /** Last sessions-list load error ('' when healthy) — surfaced as a banner. */
  sessionError = $state('')

  /** session → last read message_seq (client-local). */
  readSeqs: Record<string, number> = $state({})

  /** Per-session composer drafts, surviving navigation. */
  chatDrafts = $state<Record<string, ChatDraft>>({})

  /** Provider draft shared by the provider/model form pages. */
  providerDraft: ProviderDraft | null = $state(null)
  providersRevision = $state(0)

  /** Capability matrix from ListProvidersCatalog (api type -> capabilities).
   * Seeded with the bundled fallback; refreshed from the server on demand. */
  providerCatalog = $state<Record<string, string[]>>({ ...FALLBACK_API_TYPE_CAPABILITIES })

  async refreshProviderCatalog(): Promise<void> {
    try {
      const c = await this.api.providerCatalog()
      if (Object.keys(c).length > 0) this.providerCatalog = c
    } catch {
      /* keep the fallback */
    }
  }

  // $state: push/pop must be reactive (the Shell derives its panes from it).
  // Both tabs are pre-seeded so no lazy mutation happens during render
  // (Svelte 5 forbids state_unsafe_mutation inside deriveds).
  private stacks = $state<Record<SiderTab, AppPage[]>>({
    chat: [rootPageFor('chat')],
    config: [rootPageFor('config')],
  })

  // ---- watchSessions live list ----
  private sessionAbort: AbortController | null = null
  private sessionTimer: ReturnType<typeof setTimeout> | null = null
  private sessionAttempt = 0
  private firstSnapshot = true
  private static MAX_SESSION_ATTEMPTS = 20

  constructor(api: AgentApi, local: LocalStore | null) {
    this.api = api
    this.local = local
    this.hydrateLocal()
    this.startSessionWatch()
  }

  private async hydrateLocal() {
    const l = this.local
    if (!l) return
    try {
      // MERGE (never clobber): the stream's first snapshot can land before this
      // read resolves, and that snapshot seeds read watermarks — overriding the
      // in-memory map with the older DB copy would flash every row as unread.
      this.readSeqs = { ...(await l.loadReadSeqs()), ...this.readSeqs }
      this.chatDrafts = await l.loadDrafts()
    } catch {
      /* network-only fallback */
    }
  }

  startSessionWatch() {
    this.sessionTimer && clearTimeout(this.sessionTimer)
    this.sessionTimer = null
    this.sessionAbort?.abort()
    const ac = new AbortController()
    this.sessionAbort = ac
    void (async () => {
      try {
        for await (const ev of this.api.watchSessions()) {
          if (ac.signal.aborted) return
          this.applySessionEvent(ev.snapshot, ev.upserts, ev.removed)
        }
        this.onSessionStreamClosed()
      } catch {
        if (!ac.signal.aborted) this.onSessionStreamClosed()
      }
    })()
  }

  private onSessionStreamClosed() {
    if (this.sessionAttempt >= AppStore.MAX_SESSION_ATTEMPTS) return
    const delay = Math.min(30, 1 << Math.min(this.sessionAttempt, 5))
    this.sessionAttempt++
    this.sessionTimer = setTimeout(() => this.startSessionWatch(), delay * 1000)
  }

  private applySessionEvent(snapshot: boolean, upserts: Session[], removed: string[]) {
    this.sessionAttempt = 0
    if (snapshot) {
      this.sessions = [...upserts]
      // First ever snapshot on this device: seed read watermarks so historical
      // sessions don't pop as unread; new ones start unread at 0.
      if (this.firstSnapshot) {
        this.firstSnapshot = false
        for (const s of this.sessions) {
          if (!(s.id in this.readSeqs)) {
            this.readSeqs[s.id] = s.messageSeq
            // Mirror to the local DB: a cold start whose DB read loses the race
            // must not repopulate from an empty table and flash unread again.
            void this.local?.setReadSeq(s.id, s.messageSeq)
          }
        }
        Prefs.saveReadSeqs(this.readSeqs)
      }
    } else {
      const next = [...this.sessions]
      for (const s of upserts) {
        const i = next.findIndex(x => x.id === s.id)
        if (i === -1) next.push(s)
        else next[i] = s
      }
      this.sessions = removed.length ? next.filter(s => !removed.includes(s.id)) : next
    }
    // The open session is being read live: advance its watermark so returning
    // to the list shows no stale badge.
    const active = this.activeSession
    if (active && (this.readSeqs[active.id] ?? -1) < active.messageSeq) {
      this.readSeqs[active.id] = active.messageSeq
      Prefs.saveReadSeqs(this.readSeqs)
    }
    this.sessionError = ''
  }

  get activeSession(): Session | null {
    return this.sessions.find(s => s.id === this.activeSessionId) ?? null
  }

  sessionById(id: string): Session | null {
    return this.sessions.find(s => s.id === id) ?? null
  }

  /** Manual refresh (pull-to-refresh / fallback reconciliation). */
  async refreshSessions() {
    try {
      this.sessions = await this.api.listSessions()
      this.sessionError = ''
    } catch (e) {
      this.sessionError = String(e)
    }
  }

  async deleteSession(id: string) {
    await this.api.deleteSession(id)
    if (this.activeSessionId === id) this.closeSession()
    await this.refreshSessions()
    void this.local?.removeSession(id)
  }

  /** Delete several sessions sequentially; returns the ids that failed. */
  async deleteSessions(ids: string[]): Promise<string[]> {
    const failed: string[] = []
    let closedActive = false
    for (const id of ids) {
      try {
        await this.api.deleteSession(id)
        void this.local?.removeSession(id)
        if (this.activeSessionId === id) {
          this.activeSessionId = null
          closedActive = true
        }
      } catch {
        failed.push(id)
      }
    }
    if (closedActive) this.closeSession()
    await this.refreshSessions()
    return failed
  }

  async forkSession(branch: string): Promise<boolean> {
    const id = this.sessionById(this.activeSessionId ?? '')?.id
    if (!id) return false
    try {
      const s = await this.api.fork(id, branch)
      this.activeSessionId = s.id
      await this.refreshSessions()
      return true
    } catch {
      return false
    }
  }

  pickSession(id: string) {
    this.activeSessionId = id
    this.sessionOverlay = null
    this.markSessionRead(id)
    this.pushPage({ kind: 'chat_session', key: 'chat_session' })
  }

  /** Read state is CLIENT-LOCAL: record a per-session read watermark. */
  markSessionRead(id: string) {
    const seq = this.sessionById(id)?.messageSeq ?? this.readSeqs[id] ?? 0
    this.readSeqs[id] = seq
    Prefs.saveReadSeqs(this.readSeqs)
    void this.local?.setReadSeq(id, seq)
    this.sessions = this.sessions.map(s => (s.id === id ? { ...s, unreadCount: 0 } : s))
  }

  unreadCountFor(s: Session): number {
    const read = this.readSeqs[s.id]
    if (read == null) return s.messageSeq
    return Math.max(0, s.messageSeq - read)
  }

  isUnread(s: Session): boolean {
    return this.unreadCountFor(s) > 0
  }

  // ---- drafts ----

  draftFor(sessionId: string): ChatDraft {
    if (!this.chatDrafts[sessionId]) {
      this.chatDrafts[sessionId] = { text: '', attachments: [] }
    }
    return this.chatDrafts[sessionId]
  }

  saveDraftText(sessionId: string, text: string) {
    const d = this.draftFor(sessionId)
    if (d.text === text) return
    d.text = text
    if (!text.trim() && !d.attachments.length) {
      delete this.chatDrafts[sessionId]
      void this.local?.saveDraft(sessionId, '', [])
      return
    }
    void this.local?.saveDraft(sessionId, d.text, d.attachments)
  }

  saveDraftAttachments(sessionId: string, attachments: ChatDraft['attachments']) {
    const d = this.draftFor(sessionId)
    d.attachments = [...attachments]
    if (!d.text.trim() && !d.attachments.length) {
      delete this.chatDrafts[sessionId]
      void this.local?.saveDraft(sessionId, '', [])
      return
    }
    void this.local?.saveDraft(sessionId, d.text, d.attachments)
  }

  clearDraft(sessionId: string) {
    delete this.chatDrafts[sessionId]
    void this.local?.saveDraft(sessionId, '', [])
  }

  // ---- provider draft ----

  bumpProvidersRevision() {
    this.providersRevision++
  }

  beginProviderDraft(existing: ProviderInfo | null, capability = 'text') {
    this.providerDraft = existing ? draftFromProvider(existing) : {
      originalId: null,
      id: '',
      capability,
      apiType: 'openai-compatible',
      baseUrl: '',
      apiKey: '',
      models: [],
    }
  }

  endProviderDraft() {
    this.providerDraft = null
  }

  // ---- overlays ----

  openOverlay(v: SessionOverlay) {
    if (this.activeSessionId == null) return
    this.sessionOverlay = v
  }

  closeOverlay() {
    this.sessionOverlay = null
  }

  /** Close the open conversation; chat tab returns to the session list. */
  closeSession() {
    this.activeSessionId = null
    this.sessionOverlay = null
    const list = this.stackFor('chat')
    if (list.length > 1) list.splice(1, list.length - 1)
  }

  bumpSessionRevision() {
    this.sessionRevision++
  }

  switchTab(tab: SiderTab) {
    this.siderTab = tab
  }

  /** Apply a settings/fork/rename result onto the live list. */
  applySession(updated: Session) {
    this.sessions = this.sessions.map(s => (s.id === updated.id ? updated : s))
    this.bumpSessionRevision()
  }

  // ---- navigation stacks (per tab) ----

  private stackFor(tab: SiderTab): AppPage[] {
    return this.stacks[tab] ?? [rootPageFor(tab)]
  }

  get currentStack(): AppPage[] {
    return this.stackFor(this.siderTab)
  }

  get topPage(): AppPage {
    return this.currentStack[this.currentStack.length - 1]
  }

  /** Push a page; same-key pages replace at their existing depth. */
  pushPage(page: AppPage) {
    const list = this.currentStack
    const idx = list.findIndex(p => p.key === page.key)
    if (idx !== -1) list.splice(idx, list.length - idx)
    list.push(page)
  }

  /** Push a SIBLING drill-in (replaces the current drill-in, keeps stack at
   * [root, current] so the tablet split never shows two parallels). */
  pushSibling(page: AppPage) {
    const list = this.currentStack
    if (list.length > 1) list.splice(1, list.length - 1)
    this.pushPage(page)
  }

  /** Pop the top page; never pops below the root. */
  popPage() {
    const list = this.currentStack
    if (list.length > 1) {
      list.pop()
      if (this.siderTab === 'chat' && list.length === 1) {
        this.activeSessionId = null
        this.sessionOverlay = null
      }
    }
  }

  get canPopPage(): boolean {
    return this.currentStack.length > 1
  }
}

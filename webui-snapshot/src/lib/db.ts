// LocalStore — the web port of flutter's Drift mirror (local_db.dart +
// local_store.dart). The actual sqlite engine lives in a Worker (db-worker.ts)
// because the OPFS sync-access-handle VFS cannot run on the main thread; this
// module is the async proxy the app talks to.
//
// One sqlite file per CONNECTION SCOPE (gateway + token): a different
// user/tenant must never read another's sessions, drafts or unread watermarks.
// When the worker cannot install the OPFS pool (e.g. a second tab already holds
// it), the worker opens an in-memory DB instead, so the app still works
// network-only.
import type {
  ChatDraft,
  ChatMessage,
  Message,
  Session,
  UploadedFile,
} from './models'

export interface LocalStore {
  readonly persistent: boolean
  upsertSessions(sessions: Session[]): Promise<void>
  loadSessions(): Promise<Session[]>
  removeSession(id: string): Promise<void>
  loadMessages(sessionId: string): Promise<ChatMessage[]>
  serverTipId(sessionId: string): Promise<string>
  oldestCachedId(sessionId: string): Promise<string>
  applyServerMessages(
    sessionId: string,
    msgs: Message[],
    opts: { replace: boolean; tipId: string },
  ): Promise<void>
  persistMessages(
    sessionId: string,
    msgs: ChatMessage[],
    tipId: string,
  ): Promise<void>
  clearMessages(sessionId: string): Promise<void>
  saveDraft(
    sessionId: string,
    text: string,
    attachments: UploadedFile[],
  ): Promise<void>
  loadDrafts(): Promise<Record<string, ChatDraft>>
  loadReadSeqs(): Promise<Record<string, number>>
  setReadSeq(sessionId: string, seq: number): Promise<void>
}

type WorkerReply =
  | { type: 'ready'; persistent: boolean; error?: string }
  | { type: 'result'; id: number; result?: unknown; error?: string }

class WorkerLocalStore implements LocalStore {
  persistent = false
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >()
  private ready: Promise<void>

  constructor(private worker: Worker) {
    this.ready = new Promise<void>(resolve => {
      const onReady = (ev: MessageEvent<WorkerReply>) => {
        const m = ev.data
        if (m.type !== 'ready') return
        worker.removeEventListener('message', onReady)
        this.persistent = m.persistent
        if (m.error) console.warn('[db] init error:', m.error)
        resolve()
      }
      worker.addEventListener('message', onReady)
    })
    worker.addEventListener('message', ev =>
      this.onMessage(ev as MessageEvent<WorkerReply>),
    )
  }

  private onMessage(ev: MessageEvent<WorkerReply>): void {
    const m = ev.data
    if (m.type !== 'result') return
    const p = this.pending.get(m.id)
    if (!p) return
    this.pending.delete(m.id)
    if (m.error) p.reject(new Error(m.error))
    else p.resolve(m.result)
  }

  /** Dispatch a method call to the worker once init has completed. */
  private call(method: string, args: unknown[]): Promise<unknown> {
    return this.ready.then(
      () =>
        new Promise<unknown>((resolve, reject) => {
          const id = this.nextId++
          this.pending.set(id, { resolve, reject })
          // Callers pass Svelte `$state` proxies (messages/drafts); structured
          // clone cannot serialize a Proxy, so snapshot to plain JSON first.
          // Every arg is JSON-safe application data.
          const plain = JSON.parse(JSON.stringify(args)) as unknown[]
          this.worker.postMessage({ type: 'call', id, method, args: plain })
        }),
    )
  }

  // The public surface mirrors the worker-side LocalStore. Each returns a
  // structured-clone-safe value (plain objects/arrays), which the worker
  // already produces.
  upsertSessions = (s: Session[]) =>
    this.call('upsertSessions', [s]).then(() => {}) as Promise<void>
  loadSessions = () => this.call('loadSessions', []) as Promise<Session[]>
  removeSession = (id: string) =>
    this.call('removeSession', [id]).then(() => {}) as Promise<void>
  loadMessages = (sid: string) =>
    this.call('loadMessages', [sid]) as Promise<ChatMessage[]>
  serverTipId = (sid: string) =>
    this.call('serverTipId', [sid]) as Promise<string>
  oldestCachedId = (sid: string) =>
    this.call('oldestCachedId', [sid]) as Promise<string>
  applyServerMessages = (
    sid: string,
    msgs: Message[],
    opts: { replace: boolean; tipId: string },
  ) =>
    this.call('applyServerMessages', [sid, msgs, opts]).then(
      () => {},
    ) as Promise<void>
  persistMessages = (sid: string, msgs: ChatMessage[], tipId: string) =>
    this.call('persistMessages', [sid, msgs, tipId]).then(
      () => {},
    ) as Promise<void>
  clearMessages = (sid: string) =>
    this.call('clearMessages', [sid]).then(() => {}) as Promise<void>
  saveDraft = (sid: string, text: string, atts: UploadedFile[]) =>
    this.call('saveDraft', [sid, text, atts]).then(() => {}) as Promise<void>
  loadDrafts = () =>
    this.call('loadDrafts', []) as Promise<Record<string, ChatDraft>>
  loadReadSeqs = () =>
    this.call('loadReadSeqs', []) as Promise<Record<string, number>>
  setReadSeq = (sid: string, seq: number) =>
    this.call('setReadSeq', [sid, seq]).then(() => {}) as Promise<void>
}

let storePromise: Promise<LocalStore> | null = null
let storeScope: string | null = null

export async function openLocalStore(scope: string): Promise<LocalStore> {
  if (storePromise && storeScope === scope) return storePromise
  storeScope = scope
  const p = _open(scope).catch(e => {
    if (storePromise === p) {
      storePromise = null
      storeScope = null
    }
    throw e
  })
  storePromise = p
  return p
}

async function _open(scope: string): Promise<LocalStore> {
  const worker = new Worker(new URL('./db-worker.ts', import.meta.url), {
    type: 'module',
  })
  const store = new WorkerLocalStore(worker)
  worker.postMessage({ type: 'init', scope })
  return store
}

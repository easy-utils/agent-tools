// db-worker — owns the sqlite3 WASM instance and the OPFS-backed database.
//
// WHY A WORKER: the OPFS sync-access-handle VFS (`opfs-sahpool`) cannot run on
// the main thread (it needs Atomics.wait via a worker), and the classic `opfs`
// VFS additionally needs SharedArrayBuffer / COOP+COEP headers. `opfs-sahpool`
// needs neither SAB nor special headers — only a worker — so it is the right
// backend here. The main thread talks to this worker via db.ts.
//
// Only ONE context in the origin can hold the pool's sync access handles, so a
// second tab's install fails; that failure is reported back and the caller
// falls back to an in-memory database (network-only, no persistence).

import type { Database } from '@sqlite.org/sqlite-wasm'
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { LocalStore } from './local-store'

type InitMsg = { type: 'init'; scope: string }
type CallMsg = { type: 'call'; id: number; method: string; args: unknown[] }
type Msg = InitMsg | CallMsg

const DB_NAME_PREFIX = 'agent-webui-'

let store: LocalStore | null = null

const post = (m: unknown) => (self as unknown as Worker).postMessage(m)

async function init(scope: string): Promise<void> {
  const sqlite3 = await sqlite3InitModule()
  let db: Database
  let persistent = false
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({
      // A dedicated pool directory keeps this app's databases isolated from any
      // other OPFS sqlite user in the same origin.
      directory: '.abcp-webui',
      // Each scope opens one db (+ journal + temp files); 6 is the default and
      // comfortably covers a handful of saved connections.
      initialCapacity: 6,
    })
    db = new pool.OpfsSAHPoolDb(`/${DB_NAME_PREFIX}${scope}.sqlite3`)
    persistent = true
  } catch (e) {
    console.warn('[db-worker] OPFS unavailable — using in-memory sqlite', e)
    db = new sqlite3.oo1.DB(':memory:', 'c')
  }
  store = new LocalStore(db)
  await store.migrate()
  post({ type: 'ready', persistent })
}

self.onmessage = (ev: MessageEvent<Msg>) => {
  const msg = ev.data
  if (msg.type === 'init') {
    void init(msg.scope).catch(e =>
      post({ type: 'ready', persistent: false, error: String(e) }),
    )
    return
  }
  if (msg.type === 'call') {
    void (async () => {
      try {
        if (!store) throw new Error('db not initialized')
        const fn = (
          store as unknown as Record<string, (...a: unknown[]) => unknown>
        )[msg.method]
        if (typeof fn !== 'function')
          throw new Error(`unknown method ${msg.method}`)
        const result = await fn.apply(store, msg.args)
        post({ type: 'result', id: msg.id, result })
      } catch (e) {
        post({ type: 'result', id: msg.id, error: String(e) })
      }
    })()
  }
}

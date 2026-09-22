// LocalStore — the web port of flutter's Drift mirror (local_db.dart +
// local_store.dart) over the OFFICIAL sqlite3 WASM build. Schema and semantics
// are identical to the Flutter app (schemaVersion 3 layout).
//
// This module is the ENGINE and runs inside the db-worker (see db-worker.ts):
// the OPFS sync-access-handle VFS must not be used on the main thread, so the
// main thread only talks to a `LocalStore` through the async proxy in db.ts.
import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm'
import {
  chatPartFromJson,
  fileFromJson,
  fileToJson,
  messagePartToJson,
  partToJson,
} from './local-codecs'
import type {
  ChatDraft,
  ChatMessage,
  Message,
  Session,
  UploadedFile,
} from './models'

// ---- the store ----

export class LocalStore {
  constructor(private db: Database) {
    // Internal: use openLocalStore().
  }

  /** Run a bound statement (no rows returned). */
  private run(sql: string, bind: SqlValue[] = []): void {
    this.db.exec({ sql, bind })
  }

  /** Query rows as plain objects. */
  private all(sql: string, bind: SqlValue[] = []): Record<string, SqlValue>[] {
    return this.db.exec({
      sql,
      bind,
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as Record<string, SqlValue>[]
  }

  async migrate(): Promise<void> {
    this.db.exec(`
      PRAGMA journal_mode = MEMORY;
      CREATE TABLE IF NOT EXISTS local_sessions (
        id TEXT PRIMARY KEY,
        model TEXT NOT NULL DEFAULT '',
        variant TEXT NOT NULL DEFAULT '',
        preset TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        max_turns INTEGER NOT NULL DEFAULT 0,
        locale TEXT NOT NULL DEFAULT '',
        org TEXT NOT NULL DEFAULT '',
        repo TEXT NOT NULL DEFAULT '',
        branch TEXT NOT NULL DEFAULT '',
        server_tip_id TEXT NOT NULL DEFAULT '',
        message_seq INTEGER NOT NULL DEFAULT 0,
        group_key TEXT NOT NULL DEFAULT '',
        last_message_at TEXT NOT NULL DEFAULT '',
        last_message_preview TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT '',
        last_synced_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS local_messages (
        session_id TEXT NOT NULL,
        id TEXT NOT NULL,
        role TEXT NOT NULL,
        prev_id TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT '',
        order_key INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'complete',
        parts_json TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (session_id, id)
      );
      CREATE TABLE IF NOT EXISTS local_sync_state (
        session_id TEXT PRIMARY KEY,
        oldest_id TEXT NOT NULL DEFAULT '',
        has_more INTEGER NOT NULL DEFAULT 1,
        tip_id TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS local_drafts (
        session_id TEXT PRIMARY KEY,
        draft_text TEXT NOT NULL DEFAULT '',
        attachments_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS read_seqs (
        session_id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL DEFAULT 0
      );
    `)
    // v3 → v4: local_sessions gains the generic `group_key` column (session
    // grouping / subsessions). CREATE TABLE IF NOT EXISTS never adds a column
    // to an already-existing table, so migrate old databases explicitly.
    try {
      this.db.exec(
        "ALTER TABLE local_sessions ADD COLUMN group_key TEXT NOT NULL DEFAULT ''",
      )
    } catch {
      /* column already present */
    }
    // v4 → v5: local_messages gains the message ORIGIN `source` column. The
    // write paths left it out, so any cached rows predate it — and because the
    // incremental sync trusts its tip anchor, those rows would keep rendering
    // with an empty source (a session hand-off shown as the reader's own
    // prompt). Adding the column SUCCEEDS only once; use that as the signal to
    // drop the message cache so the next boot refetches with source intact.
    try {
      this.db.exec(
        "ALTER TABLE local_messages ADD COLUMN source TEXT NOT NULL DEFAULT ''",
      )
      this.run('DELETE FROM local_messages', [])
      this.run('DELETE FROM local_sync_state', [])
    } catch {
      /* column already present */
    }
  }

  // ---- sessions ----

  async upsertSessions(sessions: Session[]): Promise<void> {
    if (!sessions.length) return
    for (const s of sessions) {
      this.run(
        `INSERT INTO local_sessions (id, model, variant, preset, system_prompt, max_turns,
           locale, org, repo, branch, server_tip_id, message_seq, group_key, last_message_at,
           last_message_preview, updated_at, last_synced_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET model=excluded.model, variant=excluded.variant,
           preset=excluded.preset, system_prompt=excluded.system_prompt,
           max_turns=excluded.max_turns, locale=excluded.locale, org=excluded.org,
           repo=excluded.repo, branch=excluded.branch,
           server_tip_id=excluded.server_tip_id, message_seq=excluded.message_seq,
           group_key=excluded.group_key,
           last_message_at=excluded.last_message_at,
           last_message_preview=excluded.last_message_preview,
           updated_at=excluded.updated_at, last_synced_at=excluded.last_synced_at`,
        [
          s.id,
          s.model,
          s.variant,
          s.preset,
          s.systemPrompt ?? '',
          s.maxTurns ?? 0,
          s.locale ?? '',
          s.org,
          s.repo,
          s.branch,
          s.tipId ?? '',
          s.messageSeq,
          s.group,
          s.lastMessageAt,
          s.lastMessagePreview,
          s.updatedAt,
          Math.floor(Date.now() / 1000),
        ],
      )
    }
  }

  async loadSessions(): Promise<Session[]> {
    const rows = this.all(
      `SELECT * FROM local_sessions ORDER BY updated_at DESC, id`,
    )
    return rows.map(r => ({
      id: String(r['id'] ?? ''),
      model: String(r['model'] ?? ''),
      variant: String(r['variant'] ?? ''),
      preset: String(r['preset'] ?? ''),
      systemPrompt: r['system_prompt'] ? String(r['system_prompt']) : undefined,
      maxTurns: Number(r['max_turns']) || undefined,
      locale: r['locale'] ? String(r['locale']) : undefined,
      org: String(r['org'] ?? ''),
      repo: String(r['repo'] ?? ''),
      branch: String(r['branch'] ?? ''),
      tipId: r['server_tip_id'] ? String(r['server_tip_id']) : undefined,
      messageSeq: Number(r['message_seq'] ?? 0),
      group: String(r['group_key'] ?? ''),
      lastMessageAt: String(r['last_message_at'] ?? ''),
      lastMessagePreview: String(r['last_message_preview'] ?? ''),
      updatedAt: String(r['updated_at'] ?? ''),
      createdAt: '',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      lastInputTokens: 0,
      lastOutputTokens: 0,
      unreadCount: 0,
    }))
  }

  async removeSession(id: string): Promise<void> {
    this.db.exec('BEGIN')
    try {
      this.run('DELETE FROM local_messages WHERE session_id = ?', [id])
      this.run('DELETE FROM local_sync_state WHERE session_id = ?', [id])
      this.run('DELETE FROM local_sessions WHERE id = ?', [id])
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  // ---- messages ----

  private chatFromRow(r: Record<string, SqlValue>): ChatMessage {
    const parts = JSON.parse(String(r['parts_json'] || '[]')) as Record<
      string,
      unknown
    >[]
    return {
      id: String(r['id']),
      role: String(r['role']),
      status: (String(r['status']) || 'complete') as ChatMessage['status'],
      createdAt: String(r['created_at']),
      prevId: String(r['prev_id']),
      source: String(r['source'] ?? ''),
      seq: Number(r['order_key']),
      isLocal: false,
      parts: parts.map(chatPartFromJson),
    }
  }

  async loadMessages(sessionId: string): Promise<ChatMessage[]> {
    const rows = this.all(
      `SELECT * FROM local_messages WHERE session_id = ? ORDER BY order_key ASC`,
      [sessionId],
    )
    return rows.map(r => this.chatFromRow(r))
  }

  async serverTipId(sessionId: string): Promise<string> {
    const r = this.all(
      'SELECT tip_id FROM local_sync_state WHERE session_id = ?',
      [sessionId],
    )
    return r.length ? String(r[0]['tip_id']) : ''
  }

  async oldestCachedId(sessionId: string): Promise<string> {
    const r = this.all(
      'SELECT id FROM local_messages WHERE session_id = ? ORDER BY order_key ASC LIMIT 1',
      [sessionId],
    )
    return r.length ? String(r[0]['id']) : ''
  }

  /** Upsert server messages (baseline or delta) with a stable local order. */
  async applyServerMessages(
    sessionId: string,
    msgs: Message[],
    opts: { replace: boolean; tipId: string },
  ): Promise<void> {
    const { replace, tipId } = opts
    this.db.exec('BEGIN')
    try {
      if (replace) {
        this.run('DELETE FROM local_messages WHERE session_id = ?', [sessionId])
      }
      const maxRow = this.all(
        'SELECT MAX(order_key) AS k FROM local_messages WHERE session_id = ?',
        [sessionId],
      )
      let order = (maxRow.length ? Number(maxRow[0]!['k'] ?? 0) : 0) + 1
      for (const m of msgs) {
        this.run(
          `INSERT INTO local_messages (session_id, id, role, prev_id, source, created_at, order_key, status, parts_json)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(session_id, id) DO UPDATE SET role=excluded.role,
             prev_id=excluded.prev_id, source=excluded.source,
             created_at=excluded.created_at,
             status=excluded.status, parts_json=excluded.parts_json`,
          [
            sessionId,
            m.id,
            m.role,
            m.prevId,
            m.source ?? '',
            m.createdAt ?? '',
            order++,
            'complete',
            JSON.stringify(m.parts.map(messagePartToJson)),
          ],
        )
      }
      await this.upsertSyncState(sessionId, tipId)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  /** Persist the in-memory conversation as the authoritative cache. */
  async persistMessages(
    sessionId: string,
    msgs: ChatMessage[],
    tipId: string,
  ): Promise<void> {
    this.db.exec('BEGIN')
    try {
      this.run('DELETE FROM local_messages WHERE session_id = ?', [sessionId])
      let order = 0
      for (const m of msgs) {
        if (m.isLocal) continue // optimistic/streaming rows are not history
        this.run(
          `INSERT OR REPLACE INTO local_messages
             (session_id, id, role, prev_id, source, created_at, order_key, status, parts_json)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            sessionId,
            m.id,
            m.role,
            m.prevId,
            m.source ?? '',
            m.createdAt,
            order++,
            m.status,
            JSON.stringify(m.parts.map(partToJson)),
          ],
        )
      }
      await this.upsertSyncState(sessionId, tipId)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  private async upsertSyncState(
    sessionId: string,
    tipId: string,
  ): Promise<void> {
    const oldest = this.all(
      'SELECT id FROM local_messages WHERE session_id = ? ORDER BY order_key ASC LIMIT 1',
      [sessionId],
    )
    const oldestId = oldest.length ? String(oldest[0]!['id']) : ''
    const hasMore = oldest.length ? 1 : 0
    this.run(
      `INSERT INTO local_sync_state (session_id, oldest_id, has_more, tip_id)
       VALUES (?,?,?,?)
       ON CONFLICT(session_id) DO UPDATE SET oldest_id=excluded.oldest_id,
         has_more=excluded.has_more, tip_id=excluded.tip_id`,
      [sessionId, oldestId, hasMore, tipId],
    )
  }

  async clearMessages(sessionId: string): Promise<void> {
    this.db.exec('BEGIN')
    try {
      this.run('DELETE FROM local_messages WHERE session_id = ?', [sessionId])
      this.run('DELETE FROM local_sync_state WHERE session_id = ?', [sessionId])
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  // ---- drafts ----

  async saveDraft(
    sessionId: string,
    text: string,
    attachments: UploadedFile[],
  ): Promise<void> {
    if (!text.trim() && !attachments.length) {
      this.run('DELETE FROM local_drafts WHERE session_id = ?', [sessionId])
      return
    }
    this.run(
      `INSERT INTO local_drafts (session_id, draft_text, attachments_json)
       VALUES (?,?,?)
       ON CONFLICT(session_id) DO UPDATE SET draft_text=excluded.draft_text,
         attachments_json=excluded.attachments_json`,
      [sessionId, text, JSON.stringify(attachments.map(fileToJson))],
    )
  }

  async loadDrafts(): Promise<Record<string, ChatDraft>> {
    const rows = this.all('SELECT * FROM local_drafts')
    const out: Record<string, ChatDraft> = {}
    for (const r of rows) {
      const arr = JSON.parse(String(r['attachments_json'] || '[]')) as Record<
        string,
        unknown
      >[]
      out[String(r['session_id'])] = {
        text: String(r['draft_text']),
        attachments: arr.map(fileFromJson),
      }
    }
    return out
  }

  // ---- read watermarks ----

  async loadReadSeqs(): Promise<Record<string, number>> {
    const rows = this.all('SELECT session_id, seq FROM read_seqs')
    const out: Record<string, number> = {}
    for (const r of rows) out[String(r['session_id'])] = Number(r['seq'])
    return out
  }

  async setReadSeq(sessionId: string, seq: number): Promise<void> {
    this.run(
      `INSERT INTO read_seqs (session_id, seq) VALUES (?,?)
       ON CONFLICT(session_id) DO UPDATE SET seq=excluded.seq`,
      [sessionId, seq],
    )
  }
}

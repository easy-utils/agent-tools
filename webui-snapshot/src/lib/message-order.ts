// Message-list ordering — deliberately PURE (no runes, no Svelte) so it can be
// unit-tested directly and reasoned about in isolation.
//
// Model: the list is a CHAIN. Every message carries `prevId` — the id of the
// message it directly follows ('' at the head) — ASSIGNED BY THE SERVER. The
// client never mints message ids nor guesses anchor positions: it groups the
// streamed deltas under the server-authored id and places each message after
// the server-authored `prev_id`. Ordering is therefore structural and matches
// the persisted chain exactly.
//
// WHY NOT sort by time: server rows carry the SERVER clock and any client-only
// row carries the CLIENT clock; skew (mobile clocks drift) would misorder them.
// WHY NOT partition by origin: a mailbox prompt that lands while another turn
// streams is a SERVER message while the in-flight reply may still be a client
// bubble, so origin is not an ordering key either. `prevId` is.
import type { ChatMessage } from './models'

/** Order by `seq` ONLY (never `createdAt`). `seq` is re-seated by [orderMessages]. */
export function compareMessages(a: ChatMessage, b: ChatMessage): number {
  return (a.seq ?? 1 << 30) - (b.seq ?? 1 << 30)
}

/**
 * Order the list as a forest of `prevId` chains, then assign contiguous
 * `seq = index`. Siblings keep their array order (stable).
 *
 * A row with no valid anchor is a root. Server roots keep their array order; a
 * client-only root (an error bubble) sorts AFTER them, never above the chain.
 * All streamed messages carry server `prevId`s, so they slot in exactly.
 */
export function orderMessages(msgs: ChatMessage[]): ChatMessage[] {
  const index = new Map<string, number>()
  for (let i = 0; i < msgs.length; i++) index.set(msgs[i]!.id, i)
  const byId = new Map(msgs.map(m => [m.id, m]))
  const children = new Map<string, ChatMessage[]>()
  const serverRoots: ChatMessage[] = []
  const localRoots: ChatMessage[] = []
  for (const m of msgs) {
    const p = m.prevId
    // A parent we actually hold (never self, never a dangling id) makes this a
    // child; everything else is a root. Dangling ids are common transiently
    // (pagination window), so they must not drop the row.
    if (p && p !== m.id && byId.has(p)) {
      const arr = children.get(p)
      if (arr) arr.push(m)
      else children.set(p, [m])
    } else if (m.isLocal) {
      localRoots.push(m)
    } else {
      serverRoots.push(m)
    }
  }
  const byArrayOrder = (a: ChatMessage, b: ChatMessage) =>
    (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0)
  const out: ChatMessage[] = []
  const seen = new Set<string>()
  const visit = (m: ChatMessage) => {
    if (seen.has(m.id)) return // cycle guard (defensive)
    seen.add(m.id)
    out.push(m)
    const kids = children.get(m.id)
    if (kids) for (const k of [...kids].sort(byArrayOrder)) visit(k)
  }
  for (const r of [...serverRoots].sort(byArrayOrder)) visit(r)
  for (const r of [...localRoots].sort(byArrayOrder)) visit(r)
  // Defensive: any row unreachable via the walk (cyclic prevId) is appended in
  // array order so it is never silently dropped.
  for (const m of msgs) if (!seen.has(m.id)) out.push(m)
  return out.map((m, i) => ({ ...m, seq: i }))
}

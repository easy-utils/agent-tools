// Session-list ordering — "most recent first". A session's recency is its
// last-message time, falling back to the row's updated/created time so a
// brand-new session still sorts sensibly. Pure, so the store and the tests
// share one definition.
import type { Session } from './models'

/** Epoch-ms recency of a session: lastMessageAt → updatedAt → createdAt. */
export function sessionRecency(s: Session): number {
  return Date.parse(s.lastMessageAt || s.updatedAt || s.createdAt || '') || 0
}

/** A NEW array of sessions ordered newest-first (stable for equal times). */
export function sortSessionsByRecency(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => sessionRecency(b) - sessionRecency(a))
}

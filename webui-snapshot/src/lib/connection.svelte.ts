// Global connection state — tracks the two long-lived SSE streams so a page
// can show a "reconnecting" banner while either is down. The streams are
// independent: the sessions-list stream (watchSessions) and the open chat's
// stream (watchSession). Either being down means the UI is stale.
//
// Same shape as `overlays` (a plain reactive holder mutated by the
// transports): `sessions`/`chat` are set by AppStore / MessagesController.
export const connection = $state({
  /** The sessions-list stream (watchSessions) is currently disconnected. */
  sessions: false,
  /** The open chat's stream (watchSession) is currently disconnected. */
  chat: false,
})

/** True while EITHER long-lived stream is reconnecting. */
export function isReconnecting(): boolean {
  return connection.sessions || connection.chat
}

// Parsed watch/prompt stream events — port of flutter/lib/api.dart types.

/** A parsed watchSession frame. `params` is the decoded google.protobuf.Struct. */
export interface StreamEvent {
  event: string
  params: Record<string, unknown>
  /** Per-event id from the server (dedup key across replay/live overlap). */
  eid: string
  /** Turn id this event belongs to, when present. */
  runId: string
}

export function makeStreamEvent(
  event: string,
  params?: Record<string, unknown> | null,
  eid = '',
  runId = '',
): StreamEvent {
  return { event, params: params ?? {}, eid, runId }
}

/** One frame of the watchSessions list stream. */
export interface SessionListEvent {
  snapshot: boolean
  upserts: import('./models').Session[]
  removed: string[]
}

export type AuthExpiredReason = 'expired' | 'addedUser'

let onAuthExpired: ((reason: AuthExpiredReason) => void) | null = null

/** Global auth-expiry hook (mirrors flutter api.dart's onAuthExpired). */
export function setAuthExpiredHandler(
  cb: ((reason: AuthExpiredReason) => void) | null,
) {
  onAuthExpired = cb
}

export function fireAuthExpired(reason: AuthExpiredReason) {
  onAuthExpired?.(reason)
}

/** Connect error code check for auth failures (unauthenticated/permission). */
export function isAuthError(e: unknown): boolean {
  return (
    !!e &&
    typeof e === 'object' &&
    'code' in e &&
    ((e as { code?: unknown }).code === 'unauthenticated' ||
      (e as { code?: unknown }).code === 'permission_denied')
  )
}

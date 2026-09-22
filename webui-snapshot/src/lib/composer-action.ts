// Pure composer action resolution — the single morphing action circle on the
// right of the composer picks exactly one of these states from a few flags.
// Extracting the decision from the markup makes the priority order explicit
// and unit-testable (the ordering IS the spec).
export type ComposerAction =
  | 'awaiting-send' // prompt en route to the mailbox (RPC+confirm) → spinner
  | 'deliver' // a turn runs and there is content → envelope (mailbox)
  | 'stop' // a turn runs, nothing to deliver → stop
  | 'submitting' // our own submit is uploading/sending → spinner
  | 'send' // idle with content → send
  | 'attach' // idle, empty → attach

export interface ComposerState {
  /** Prompt is en route to the mailbox (from submit until `accepted`). */
  awaitingSend: boolean
  /** A turn is running on the server (or believed to be). */
  sending: boolean
  /** A turn runs and there is anything to hand off (text or an attachment). */
  canDeliver: boolean
  /** Our own submit is uploading/sending right now. */
  submitting: boolean
  /** Idle with sendable content (text or a coded attachment). */
  canSend: boolean
}

/**
 * Resolve the action. Precedence, highest first:
 *   awaitingSend → deliver → stop → submitting → send → attach
 *
 * `deliver` outranks `stop`: while a turn runs, typed/recorded content turns
 * the STOP circle into the envelope, because delivering to the mailbox is the
 * whole point of that affordance. `stop` only stands when there is nothing to
 * deliver.
 */
export function composerAction(s: ComposerState): ComposerAction {
  if (s.awaitingSend) return 'awaiting-send'
  if (s.sending) return s.canDeliver ? 'deliver' : 'stop'
  if (s.submitting) return 'submitting'
  return s.canSend ? 'send' : 'attach'
}

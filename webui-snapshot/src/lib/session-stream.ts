// SessionStream — the live per-session transport. It owns the raw
// `watchSession` subscription, exponential-backoff reconnect, eid dedup, run
// boundaries, the half-open-stream watchdog and the idle probe. It knows
// nothing about message content: each deduped, boundary-handled event is
// handed to `onEvent`; the stream's cross-cutting needs (is a turn running?
// has it gone idle?) are answered through the other callbacks.
//
// Extracted from MessagesController so that class reads as "public actions +
// wiring" and this subtle, timer-heavy code stands alone.
import type { AgentApi } from './api'
import type { StreamEvent } from './events'

export interface StreamHandlers {
  /** Id of the session the user currently has open ('' when none). */
  getSessionId(): string
  /** Anchor to replay from (the newest server message id we hold). */
  getSince(): string
  /** Is a turn believed to be running (drives the watchdog + probes)? */
  isSending(): boolean
  /** A deduped, run-boundary-handled stream event. */
  onEvent(ev: StreamEvent): void
  /** A new run began (or replay started): drop stale streaming state. */
  onRunBoundary(): void
  /** The server answered idle: converge and pull any missed delta. */
  onIdle(): void
  /** The stream closed: converge to idle (no delta pull). */
  onStreamClosed(): void
  /** The server answered busy: make sure the store reflects it. */
  onBusy(): void
  /** A long-lived connection was lost (drives the reconnect banner). */
  onDisconnected(): void
  /** The connection is confirmed alive again (event, probe, or dispose). */
  onConnected(): void
}

export class SessionStream {
  private static INITIAL_RECONNECT = 1000
  private static MAX_RECONNECT_MS = 30_000
  private static IDLE_PROBE_EVERY = 20_000
  /**
   * A long-lived server stream can go HALF-OPEN: the socket dies (mobile
   * network handoff, NAT timeout, HTTP/2 GOAWAY lost) but `read()` neither
   * resolves nor rejects, so `onStreamClosed` never fires and the client waits
   * forever. The sidebar keeps updating (it uses a SEPARATE `watchSessions`
   * stream) while the open chat freezes — the classic "must refresh to see the
   * reply" bug. These bound the silence: once a believed-active turn has
   * produced no stream event for STREAM_STALE_MS, force a reconnect.
   */
  private static STREAM_STALE_MS = 15_000
  private static WATCHDOG_EVERY = 5_000
  /** Bounded liveness probe: a healthy transport must answer State fast. */
  private static PROBE_TIMEOUT_MS = 4_000
  /** While the transport stays healthy, reconnect at most this often. */
  private static HEALTHY_RECONNECT_COOLDOWN_MS = 60_000

  private streamAbort: AbortController | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private subSid: string | null = null

  private seenEids = new Set<string>()
  private activeRunId: string | null = null
  private awaitingRun = false

  private idleProbeTimer: ReturnType<typeof setInterval> | null = null
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private lastActivity = Date.now()
  /** Wall-clock of the last event RECEIVED on the per-session stream. */
  private lastStreamEventAt = Date.now()
  private lastRecoveryAt = 0
  private probing = false

  constructor(
    private api: AgentApi,
    private h: StreamHandlers,
  ) {}

  /** Open (or re-open) the stream for `sid`, resetting the backoff budget. */
  connect(sid: string) {
    this.reconnectTimer && clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.streamAbort?.abort()
    const ac = new AbortController()
    this.streamAbort = ac
    this.subSid = sid
    this.reconnectAttempt = 0
    this.lastActivity = Date.now()
    this.idleProbeTimer && clearInterval(this.idleProbeTimer)
    // Run boundary: the FIRST event of the new connection resets stale
    // streaming state; replay rebuilds it cleanly.
    this.seenEids.clear()
    this.activeRunId = null
    this.awaitingRun = true
    this.lastStreamEventAt = Date.now()
    void (async () => {
      try {
        for await (const ev of this.api.streamEvents(
          sid,
          this.h.getSince(),
          ac.signal,
        )) {
          if (ac.signal.aborted) return
          this.lastStreamEventAt = Date.now()
          this.handleEvent(ev)
        }
        this.onStreamClosed(sid)
      } catch {
        if (!ac.signal.aborted) this.onStreamClosed(sid)
      }
    })()
    this.startIdleProbe()
    this.startWatchdog()
  }

  dispose() {
    this.reconnectTimer && clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.idleProbeTimer && clearInterval(this.idleProbeTimer)
    this.idleProbeTimer = null
    this.watchdogTimer && clearInterval(this.watchdogTimer)
    this.watchdogTimer = null
    this.streamAbort?.abort()
    this.streamAbort = null
    // Closing the chat (or switching sessions) is not a connection problem:
    // clear the banner so a disposed stream does not leave it stuck on.
    this.h.onConnected()
  }

  /** Forget the active run (a run ended or the stream state was reset). */
  resetRun() {
    this.activeRunId = null
  }

  private handleEvent(ev: StreamEvent) {
    this.lastActivity = Date.now()
    // A live event proves the connection is healthy again.
    this.h.onConnected()
    // Dedup across the subscribe/replay overlap.
    if (ev.eid) {
      if (this.seenEids.has(ev.eid)) return
      this.seenEids.add(ev.eid)
      if (this.seenEids.size > 20000) this.seenEids.clear()
    }
    // Run boundary handling.
    if (this.awaitingRun) {
      this.awaitingRun = false
      this.h.onRunBoundary()
    }
    const run = ev.runId
    if (run && run !== this.activeRunId) {
      if (this.activeRunId != null) this.h.onRunBoundary()
      this.activeRunId = run
    }
    this.h.onEvent(ev)
  }

  private onStreamClosed(sid: string) {
    if (this.subSid != null && this.subSid !== sid) return
    // The connection is down: surface the reconnect banner until it recovers.
    this.h.onDisconnected()
    // Converge to idle if the stream ended without a terminal event.
    this.h.onStreamClosed()
    if (sid !== this.h.getSessionId()) return
    // Retry FOREVER (WeChat-style): the banner stays until the server is back.
    // The backoff is capped, so this is a bounded-rate poll, not a storm.
    const delay = Math.min(
      SessionStream.MAX_RECONNECT_MS,
      SessionStream.INITIAL_RECONNECT * 2 ** this.reconnectAttempt,
    )
    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(() => this.connect(sid), delay)
  }

  /**
   * Detect a HALF-OPEN per-session stream and force a reconnect. When the
   * session is believed busy but no stream event has arrived for
   * STREAM_STALE_MS, the stream may be dead WITHOUT an error (a dropped socket
   * or a server-side ordered consumer that stopped yielding) — so
   * `onStreamClosed` never fires and the client waits forever. Tear it down and
   * reconnect; the new subscription replays from the tip anchor (eid dedup
   * makes the overlap harmless). This is what lets a mailbox-drained
   * continuation surface without a manual page refresh.
   *
   * `lastStreamEventAt` is reset on every reconnect, so a genuinely long quiet
   * tool reconnects at most once per STREAM_STALE_MS — bounded and safe.
   */
  private startWatchdog() {
    this.watchdogTimer && clearInterval(this.watchdogTimer)
    this.watchdogTimer = setInterval(() => {
      if (!this.h.isSending()) return
      if (Date.now() - this.lastStreamEventAt < SessionStream.STREAM_STALE_MS)
        return
      const sid = this.subSid ?? this.h.getSessionId()
      if (!sid || sid !== this.h.getSessionId()) return
      void this.recoverStaleStream(sid)
    }, SessionStream.WATCHDOG_EVERY)
  }

  /**
   * Decide whether a silent stream is dead and reconnect if so.
   *
   * A unary `State` over the SAME connection is the discriminator:
   *  - it hangs/errors  → the transport is half-open (dead socket): reconnect
   *    immediately, resetting the backoff budget (liveness, not a crash loop).
   *  - it answers idle  → the turn finished but its terminal event was lost:
   *    converge and pull the delta.
   *  - it answers busy  → the transport is healthy but the ordered consumer
   *    stopped yielding (or a genuinely quiet long tool). Reconnect anyway —
   *    replay-from-anchor + eid dedup make it harmless — but rate-limit to one
   *    attempt per HEALTHY_RECONNECT_COOLDOWN_MS so a quiet tool cannot cause
   *    a reconnect storm.
   */
  private async recoverStaleStream(sid: string): Promise<void> {
    if (this.probing) return
    this.probing = true
    try {
      const probe = await Promise.race([
        this.api
          .state(sid)
          .then(([st]) =>
            st === 'busy' || st === 'running'
              ? ('busy' as const)
              : ('idle' as const),
          )
          .catch(() => 'dead' as const),
        new Promise<'timeout'>(r =>
          setTimeout(() => r('timeout'), SessionStream.PROBE_TIMEOUT_MS),
        ),
      ])
      // A fresh event may have landed while probing: stand down.
      if (Date.now() - this.lastStreamEventAt < SessionStream.STREAM_STALE_MS)
        return
      if (sid !== this.h.getSessionId()) return
      if (probe === 'idle') {
        this.h.onIdle()
        return
      }
      const now = Date.now()
      if (
        probe === 'busy' &&
        now - this.lastRecoveryAt < SessionStream.HEALTHY_RECONNECT_COOLDOWN_MS
      ) {
        return
      }
      this.lastRecoveryAt = now
      this.reconnectAttempt = 0
      this.lastStreamEventAt = now
      this.streamAbort?.abort()
      this.connect(sid)
    } finally {
      this.probing = false
    }
  }

  private startIdleProbe() {
    this.idleProbeTimer && clearInterval(this.idleProbeTimer)
    this.idleProbeTimer = setInterval(() => {
      if (Date.now() - this.lastActivity < SessionStream.IDLE_PROBE_EVERY)
        return
      this.api
        .state(this.h.getSessionId())
        .then(([st]) => {
          // A successful unary over the same connection proves it is healthy,
          // so an idle session (no stream events) still clears the banner.
          this.h.onConnected()
          if (st === 'busy' || st === 'running') {
            this.h.onBusy()
          } else {
            // Idle on the server: converge and PULL anything the stream missed
            // (a half-open window can swallow the final turn-complete).
            this.h.onIdle()
          }
        })
        .catch(() => {})
    }, SessionStream.IDLE_PROBE_EVERY)
  }
}

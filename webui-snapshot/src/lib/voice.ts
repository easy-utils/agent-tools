// VoiceRecorder — captures microphone PCM with the Web Audio API and encodes
// a mono 16-bit WAV (16 kHz), matching Flutter's recorder. MediaRecorder is
// deliberately NOT used: it only yields WebM/Opus (Chrome) or MP4/AAC (Safari),
// and the ASR gateway rejects WebM outright (and a WebM container sniffs as
// `video/webm`, so the attachment card rendered as video).
//
// The pure PCM/WAV encoding lives in audio-encode.ts.
import { concat, encodeWav, MIN_VOICE_BYTES, SAMPLE_RATE } from './audio-encode'

/** AudioWorklet processor source (loaded from a Blob URL — no build asset). */
const WORKLET_SRC = `
class AbcpRecProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('abcp-rec', AbcpRecProcessor)
`

export interface VoiceClip {
  name: string
  mimeType: string
  bytes: Uint8Array
}

export class VoiceRecorder {
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private worklet: AudioWorkletNode | null = null
  private processor: ScriptProcessorNode | null = null
  private workletUrl: string | null = null
  /** Collected mono Float32 frames (concatenated in stop()). */
  private frames: Float32Array[] = []
  private cancelled = false
  /**
   * The in-flight `start()`. `getUserMedia` is async, so a release that lands
   * before it resolves must WAIT for the stream and then stop it — otherwise
   * the mic stays open (a leaked recording indicator).
   */
  private starting: Promise<void> | null = null
  /** Set when stop()/cancel() ran while start() was still pending. */
  private stopRequested = false

  async hasPermission(): Promise<boolean> {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach(t => {
        t.stop()
      })
      return true
    } catch {
      return false
    }
  }

  async start(): Promise<boolean> {
    if (this.starting !== null) return true
    this.stopRequested = false
    this.cancelled = false
    this.frames = []
    const p = (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // A release may have arrived while getUserMedia was pending: release the
      // freshly-granted stream and attach nothing.
      if (this.stopRequested) {
        stream.getTracks().forEach(t => {
          t.stop()
        })
        return
      }
      this.stream = stream
      // Ask the context for 16 kHz directly; the browser resamples the mic.
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      const ctx = new Ctor({ sampleRate: SAMPLE_RATE })
      this.ctx = ctx
      if (ctx.state === 'suspended') await ctx.resume()
      const source = ctx.createMediaStreamSource(stream)
      this.source = source
      try {
        await this.attachWorklet(ctx, source)
      } catch {
        // Older browsers without AudioWorklet: fall back to ScriptProcessor.
        this.attachScriptProcessor(ctx, source)
      }
    })()
    this.starting = p
    try {
      await p
      return this.ctx !== null
    } catch {
      return false
    } finally {
      this.starting = null
    }
  }

  private async attachWorklet(
    ctx: AudioContext,
    source: MediaStreamAudioSourceNode,
  ): Promise<void> {
    if (ctx.audioWorklet === undefined) throw new Error('no AudioWorklet')
    const url = URL.createObjectURL(
      new Blob([WORKLET_SRC], { type: 'application/javascript' }),
    )
    this.workletUrl = url
    await ctx.audioWorklet.addModule(url)
    // Keep ONE output: a 0-output node cannot be connected, and the failed
    // connect would trigger the ScriptProcessor fallback while this worklet is
    // already wired to the source — capturing the mic TWICE (duplicate audio).
    const node = new AudioWorkletNode(ctx, 'abcp-rec')
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!this.cancelled) this.frames.push(e.data)
    }
    source.connect(node)
    // Route the (silent) output to the destination so the graph keeps pulling.
    const mute = ctx.createGain()
    mute.gain.value = 0
    node.connect(mute).connect(ctx.destination)
    this.worklet = node
  }

  private attachScriptProcessor(
    ctx: AudioContext,
    source: MediaStreamAudioSourceNode,
  ): void {
    const node = ctx.createScriptProcessor(4096, 1, 1)
    node.onaudioprocess = e => {
      if (this.cancelled) return
      this.frames.push(new Float32Array(e.inputBuffer.getChannelData(0)))
    }
    const mute = ctx.createGain()
    mute.gain.value = 0
    source.connect(node)
    node.connect(mute).connect(ctx.destination)
    this.processor = node
  }

  /** Release every resource immediately (mic indicator clears here). */
  private teardown() {
    try {
      this.worklet?.port.close()
    } catch {
      /* ignore */
    }
    try {
      this.processor?.disconnect()
    } catch {
      /* ignore */
    }
    try {
      this.worklet?.disconnect()
    } catch {
      /* ignore */
    }
    try {
      this.source?.disconnect()
    } catch {
      /* ignore */
    }
    this.stream?.getTracks().forEach(t => {
      t.stop()
    })
    void this.ctx?.close().catch(() => {})
    if (this.workletUrl !== null) {
      URL.revokeObjectURL(this.workletUrl)
      this.workletUrl = null
    }
    this.worklet = null
    this.processor = null
    this.source = null
    this.stream = null
    this.ctx = null
  }

  /** Stop and return the recording as a WAV upload source (null when empty). */
  async stop(): Promise<VoiceClip | null> {
    // Flag first so a still-pending start() tears down on arrival, then wait
    // for it so we observe the context it (maybe) created.
    this.stopRequested = true
    const pending = this.starting
    if (pending !== null) {
      try {
        await pending
      } catch {
        /* start failed */
      }
    }
    const rate = this.ctx?.sampleRate ?? SAMPLE_RATE
    const cancelled = this.cancelled
    const frames = this.frames
    this.frames = []
    this.teardown()
    if (cancelled) return null
    const pcm = concat(frames)
    if (pcm.length * 2 < MIN_VOICE_BYTES) return null
    const bytes = encodeWav(pcm, rate)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    return { name: `voice-${stamp}.wav`, mimeType: 'audio/wav', bytes }
  }

  async cancel() {
    this.cancelled = true
    this.stopRequested = true
    const pending = this.starting
    if (pending !== null) {
      try {
        await pending
      } catch {
        /* start failed */
      }
    }
    this.frames = []
    this.teardown()
  }

  dispose() {
    this.stopRequested = true
    this.frames = []
    this.teardown()
  }
}

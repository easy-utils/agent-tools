// VoiceRecorder — captures microphone PCM with the Web Audio API and encodes
// a mono 16-bit WAV (16 kHz), matching Flutter's recorder. MediaRecorder is
// deliberately NOT used: it only yields WebM/Opus (Chrome) or MP4/AAC (Safari),
// and the ASR gateway rejects WebM outright (and a WebM container sniffs as
// `video/webm`, so the attachment card rendered as video).

/** Target capture rate; matches Flutter's RecordConfig (16 kHz mono). */
const SAMPLE_RATE = 16000
/** Minimum PCM payload (bytes); below ≈0.4 s is an accidental tap. */
const MIN_VOICE_BYTES = SAMPLE_RATE * 2 * 0.4 // 12800

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
      s.getTracks().forEach(t => t.stop())
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
        stream.getTracks().forEach(t => t.stop())
        return
      }
      this.stream = stream
      // Ask the context for 16 kHz directly; the browser resamples the mic.
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
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

  private async attachWorklet(ctx: AudioContext, source: MediaStreamAudioSourceNode): Promise<void> {
    if (ctx.audioWorklet === undefined) throw new Error('no AudioWorklet')
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }))
    this.workletUrl = url
    await ctx.audioWorklet.addModule(url)
    const node = new AudioWorkletNode(ctx, 'abcp-rec', { numberOfOutputs: 0 })
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!this.cancelled) this.frames.push(e.data)
    }
    source.connect(node)
    // A worklet with no output still needs to be pulled; a muted gain to the
    // destination keeps the graph alive without echoing the mic.
    const mute = ctx.createGain()
    mute.gain.value = 0
    node.connect(mute).connect(ctx.destination)
    this.worklet = node
  }

  private attachScriptProcessor(ctx: AudioContext, source: MediaStreamAudioSourceNode): void {
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
    try { this.worklet?.port.close() } catch { /* ignore */ }
    try { this.processor?.disconnect() } catch { /* ignore */ }
    try { this.worklet?.disconnect() } catch { /* ignore */ }
    try { this.source?.disconnect() } catch { /* ignore */ }
    this.stream?.getTracks().forEach(t => t.stop())
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
      try { await pending } catch { /* start failed */ }
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
      try { await pending } catch { /* start failed */ }
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

/** Concatenate the collected mono frames into one buffer. */
function concat(frames: Float32Array[]): Float32Array {
  let n = 0
  for (const f of frames) n += f.length
  const out = new Float32Array(n)
  let o = 0
  for (const f of frames) {
    out.set(f, o)
    o += f.length
  }
  return out
}

/** Float32 [-1,1] mono → 16-bit PCM WAV (44-byte canonical header). */
function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2
  const buf = new ArrayBuffer(44 + dataBytes)
  const dv = new DataView(buf)
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  dv.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  dv.setUint32(16, 16, true) // PCM chunk size
  dv.setUint16(20, 1, true) // PCM
  dv.setUint16(22, 1, true) // mono
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * 2, true) // byte rate (mono * 16-bit)
  dv.setUint16(32, 2, true) // block align
  dv.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  dv.setUint32(40, dataBytes, true)
  let off = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    off += 2
  }
  return new Uint8Array(buf)
}

// Pure PCM helpers for the voice recorder: concatenate captured Float32 frames
// and encode them as a canonical 16-bit mono WAV. No Web Audio / DOM, so they
// can be unit-tested with synthetic samples.
//
// MediaRecorder is deliberately NOT used by the recorder: it only yields
// WebM/Opus (Chrome) or MP4/AAC (Safari), and the ASR gateway rejects WebM
// outright.

/** Target capture rate; matches Flutter's RecordConfig (16 kHz mono). */
export const SAMPLE_RATE = 16000
/** Minimum PCM payload (bytes); below ≈0.4 s is an accidental tap. */
export const MIN_VOICE_BYTES = SAMPLE_RATE * 2 * 0.4 // 12800

/** Concatenate the collected mono frames into one buffer. */
export function concat(frames: Float32Array[]): Float32Array {
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
export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
): Uint8Array {
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

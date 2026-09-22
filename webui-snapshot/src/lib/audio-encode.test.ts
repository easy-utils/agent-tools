// Pure PCM/WAV encoder tests — header fields and sample quantization.
import { describe, expect, it } from 'vitest'
import { concat, encodeWav } from './audio-encode'

function ascii(view: DataView, off: number, len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(off + i))
  return s
}

describe('concat', () => {
  it('concatenates frames in order', () => {
    const out = concat([new Float32Array([1, 2]), new Float32Array([3])])
    expect([...out]).toEqual([1, 2, 3])
  })

  it('returns an empty buffer for no frames', () => {
    expect(concat([]).length).toBe(0)
  })
})

describe('encodeWav', () => {
  it('writes a canonical 44-byte mono 16-bit header', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1])
    const out = encodeWav(samples, 16000)
    const dv = new DataView(out.buffer)
    expect(out.length).toBe(44 + samples.length * 2)
    expect(ascii(dv, 0, 4)).toBe('RIFF')
    expect(dv.getUint32(4, true)).toBe(36 + samples.length * 2)
    expect(ascii(dv, 8, 4)).toBe('WAVE')
    expect(ascii(dv, 12, 4)).toBe('fmt ')
    expect(dv.getUint32(16, true)).toBe(16)
    expect(dv.getUint16(20, true)).toBe(1) // PCM
    expect(dv.getUint16(22, true)).toBe(1) // mono
    expect(dv.getUint32(24, true)).toBe(16000)
    expect(dv.getUint32(28, true)).toBe(32000) // byte rate
    expect(dv.getUint16(32, true)).toBe(2) // block align
    expect(dv.getUint16(34, true)).toBe(16) // bits per sample
    expect(ascii(dv, 36, 4)).toBe('data')
    expect(dv.getUint32(40, true)).toBe(samples.length * 2)
  })

  it('quantizes samples to 16-bit and clamps out-of-range input', () => {
    const out = encodeWav(new Float32Array([0, 1, -1, 2]), 16000)
    const dv = new DataView(out.buffer)
    expect(dv.getInt16(44, true)).toBe(0)
    expect(dv.getInt16(46, true)).toBe(0x7fff)
    expect(dv.getInt16(48, true)).toBe(-0x8000)
    // 2 clamps to the same positive peak as 1.
    expect(dv.getInt16(50, true)).toBe(0x7fff)
  })
})

/**
 * Honeycomb identicon — exact port of flutter/lib/widgets/chat_avatar.dart
 * (branch level) and compose-app ChatAvatar.kt.
 *
 * The hash + pattern must match the other clients bit-for-bit, so the
 * arithmetic is deliberately the same shape: FNV-1a over the seed (masked to
 * 31 bits per step), then the same `mix` finalizer. `Math.imul` reproduces the
 * 32-bit modular product the Dart/Kotlin versions compute.
 */

export interface HexCell {
  x: number
  y: number
  r: number
  on: boolean
}

const HEX_SIZE = 0.1

function fnv(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) & 0x7fffffff
  }
  return h
}

function mix(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  return (x ^ (x >>> 16)) >>> 0
}

function bitAt(seed: string, i: number): boolean {
  if (!seed) return (i & 1) === 0
  return (mix(fnv(`${seed}#${i}`)) & 1) === 1
}

export function hueOf(source: string): number {
  return fnv(source) % 360
}

/** Mirror-symmetric, branch-seeded honeycomb (only hexes fully inside the disc). */
export function honeycombCells(seed: string, mirror: boolean): HexCell[] {
  const r = HEX_SIZE
  const stepX = Math.sqrt(3) * r
  const stepY = 1.5 * r
  const cells: HexCell[] = []
  for (let row = -8; row <= 8; row++) {
    const y = row * stepY
    const xOff = row % 2 !== 0 ? stepX / 2 : 0
    for (let col = -8; col <= 8; col++) {
      const x = col * stepX + xOff
      if (Math.sqrt(x * x + y * y) > 0.5 - r) continue
      cells.push({ x, y, r, on: true })
    }
  }
  if (!mirror) return cells.map((c, i) => ({ ...c, on: bitAt(seed, i) }))

  const key = (x: number, y: number) =>
    `${(x * 1_000_000).toFixed(0)}|${(y * 1_000_000).toFixed(0)}`
  const byCoord = new Map<string, number>()
  cells.forEach((c, i) => {
    byCoord.set(key(-c.x, c.y), i)
  })
  const on = new Array<boolean>(cells.length).fill(false)
  cells.forEach((c, i) => {
    if (on[i]) return
    const mi = byCoord.get(key(c.x, c.y)) ?? i
    const bit = bitAt(seed, Math.min(i, mi))
    on[i] = bit
    if (mi !== i) on[mi] = bit
  })
  return cells.map((c, i) => ({ ...c, on: on[i]! }))
}

function hsl(
  hue: number,
  sat: number,
  light: number,
): [number, number, number] {
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const hp = hue / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r1 = 0
  let g1 = 0
  let b1 = 0
  if (hp < 1) [r1, g1, b1] = [c, x, 0]
  else if (hp < 2) [r1, g1, b1] = [x, c, 0]
  else if (hp < 3) [r1, g1, b1] = [0, c, x]
  else if (hp < 4) [r1, g1, b1] = [0, x, c]
  else if (hp < 5) [r1, g1, b1] = [x, 0, c]
  else [r1, g1, b1] = [c, 0, x]
  const m = light - c / 2
  const ch = (v: number) => Math.round(Math.min(1, Math.max(0, v + m)) * 255)
  return [ch(r1), ch(g1), ch(b1)]
}

const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`

function luminance([r, g, b]: [number, number, number]): number {
  const ch = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

function contrastRatio(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export interface AvatarSpec {
  bg: string
  fg: string
  hexes: HexCell[]
}

export function avatarSpec(seed: string): AvatarSpec {
  const hue = hueOf(seed)
  const bgRgb = hsl(hue, 0.6, 0.48)
  const darkRungs = [0.34, 0.28, 0.22, 0.17, 0.12]
  const lightRungs = [0.66, 0.72, 0.78, 0.84, 0.9]
  let best = hsl(hue, 0.62, 0.66)
  let bestRatio = -1
  for (const l of [...darkRungs, ...lightRungs]) {
    const c = hsl(hue, 0.62, l)
    const ratio = contrastRatio(c, bgRgb)
    if (ratio > bestRatio) {
      bestRatio = ratio
      best = c
    }
    if (bestRatio >= 3.5) break
  }
  const fgRgb =
    bestRatio < 3.0
      ? luminance(bgRgb) > 0.35
        ? [23, 24, 28]
        : [255, 255, 255]
      : best
  return {
    bg: rgb(bgRgb),
    fg: rgb(fgRgb as [number, number, number]),
    hexes: honeycombCells(seed, true),
  }
}

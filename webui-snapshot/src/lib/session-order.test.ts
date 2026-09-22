// Session ordering tests — newest-first by lastMessageAt → updatedAt →
// createdAt, stable for equal recency.
import { describe, expect, it } from 'vitest'
import type { Session } from './models'
import { sessionRecency, sortSessionsByRecency } from './session-order'

function s(over: Partial<Session> & { id: string }): Session {
  return {
    model: '',
    variant: '',
    preset: '',
    org: '',
    repo: '',
    branch: '',
    createdAt: '',
    updatedAt: '',
    lastMessageAt: '',
    lastMessagePreview: '',
    messageSeq: 0,
    group: '',
    ...over,
  } as Session
}

describe('sessionRecency', () => {
  it('prefers lastMessageAt', () => {
    const t = s({
      id: 'a',
      lastMessageAt: '2026-01-02T00:00:00Z',
      updatedAt: '2026-01-03T00:00:00Z',
    })
    expect(sessionRecency(t)).toBe(Date.parse('2026-01-02T00:00:00Z'))
  })

  it('falls back to updatedAt, then createdAt', () => {
    expect(
      sessionRecency(s({ id: 'a', updatedAt: '2026-01-03T00:00:00Z' })),
    ).toBe(Date.parse('2026-01-03T00:00:00Z'))
    expect(
      sessionRecency(s({ id: 'a', createdAt: '2026-01-04T00:00:00Z' })),
    ).toBe(Date.parse('2026-01-04T00:00:00Z'))
  })

  it('is 0 for an unparseable/empty timestamp', () => {
    expect(sessionRecency(s({ id: 'a' }))).toBe(0)
    expect(sessionRecency(s({ id: 'a', lastMessageAt: 'nonsense' }))).toBe(0)
  })
})

describe('sortSessionsByRecency', () => {
  it('orders newest first', () => {
    const out = sortSessionsByRecency([
      s({ id: 'old', lastMessageAt: '2026-01-01T00:00:00Z' }),
      s({ id: 'new', lastMessageAt: '2026-01-03T00:00:00Z' }),
      s({ id: 'mid', lastMessageAt: '2026-01-02T00:00:00Z' }),
    ])
    expect(out.map(x => x.id)).toEqual(['new', 'mid', 'old'])
  })

  it('does not mutate the input', () => {
    const input = [
      s({ id: 'a', lastMessageAt: '2026-01-01T00:00:00Z' }),
      s({ id: 'b', lastMessageAt: '2026-01-02T00:00:00Z' }),
    ]
    const before = input.map(x => x.id)
    sortSessionsByRecency(input)
    expect(input.map(x => x.id)).toEqual(before)
  })

  it('keeps an in-place timestamp bump from leaving the row out of order', () => {
    // Simulates the live-upsert bug: 'a' was first, then its lastMessageAt
    // advanced — it must move to the top.
    const a = s({ id: 'a', lastMessageAt: '2026-01-01T00:00:00Z' })
    const b = s({ id: 'b', lastMessageAt: '2026-01-02T00:00:00Z' })
    const before = sortSessionsByRecency([a, b])
    expect(before.map(x => x.id)).toEqual(['b', 'a'])
    const updatedA = { ...a, lastMessageAt: '2026-01-05T00:00:00Z' }
    const after = sortSessionsByRecency([updatedA, b])
    expect(after.map(x => x.id)).toEqual(['a', 'b'])
  })
})

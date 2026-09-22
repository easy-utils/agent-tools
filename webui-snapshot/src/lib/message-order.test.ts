import { describe, expect, it } from 'vitest'
import { compareMessages, orderMessages } from './message-order'
import type { ChatMessage } from './models'

/** Minimal message factory; only the fields ordering touches are set. */
function msg(over: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    role: 'user',
    status: 'complete',
    parts: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    prevId: '',
    isLocal: false,
    source: '',
    seq: 0,
    ...over,
  }
}

const ids = (msgs: ChatMessage[]) => msgs.map(m => m.id)

describe('compareMessages', () => {
  it('orders purely by seq', () => {
    const a = msg({ id: 'a', seq: 2 })
    const b = msg({ id: 'b', seq: 1 })
    expect(compareMessages(a, b)).toBeGreaterThan(0)
    expect(compareMessages(b, a)).toBeLessThan(0)
  })

  it('IGNORES createdAt (the clock-skew bug): earlier timestamp with larger seq still sorts later', () => {
    const placeholder = msg({
      id: 'assistant',
      seq: 2,
      createdAt: '2020-01-01T00:00:00.000Z',
    })
    const persistedUser = msg({
      id: 'user',
      seq: 1,
      createdAt: '2030-01-01T00:00:00.000Z',
    })
    const sorted = [placeholder, persistedUser].sort(compareMessages)
    expect(ids(sorted)).toEqual(['user', 'assistant'])
  })

  it('treats a missing seq as last', () => {
    const withSeq = msg({ id: 'a', seq: 5 })
    const without = msg({ id: 'b', seq: undefined })
    expect(compareMessages(without, withSeq)).toBeGreaterThan(0)
  })
})

describe('orderMessages (server-authored chain)', () => {
  it('renders user A -> assistant A -> user B -> assistant B by prevId, regardless of array order', () => {
    // Every id and anchor is server-authored: A's reply and B's prompt both
    // arrive as server messages, chained by prev_id.
    const uA = msg({ id: 'uA' })
    const aA = msg({ id: 'aA', role: 'assistant', prevId: 'uA' })
    const uB = msg({ id: 'uB', prevId: 'aA' })
    const aB = msg({ id: 'aB', role: 'assistant', prevId: 'uB' })
    // Deliberately scrambled array order.
    expect(ids(orderMessages([uB, aB, uA, aA]))).toEqual([
      'uA',
      'aA',
      'uB',
      'aB',
    ])
  })

  it('orders a clean server chain by prevId', () => {
    const m3 = msg({ id: 'm3', prevId: 'm2' })
    const m1 = msg({ id: 'm1' })
    const m2 = msg({ id: 'm2', prevId: 'm1' })
    expect(ids(orderMessages([m3, m1, m2]))).toEqual(['m1', 'm2', 'm3'])
  })

  it('keeps root order stable (array order) for sibling roots', () => {
    const r1 = msg({ id: 'r1' })
    const r2 = msg({ id: 'r2' })
    expect(ids(orderMessages([r1, r2]))).toEqual(['r1', 'r2'])
    expect(ids(orderMessages([r2, r1]))).toEqual(['r2', 'r1'])
  })

  it('keeps sibling children in array order', () => {
    const root = msg({ id: 'root' })
    const c1 = msg({ id: 'c1', prevId: 'root' })
    const c2 = msg({ id: 'c2', prevId: 'root' })
    expect(ids(orderMessages([root, c1, c2]))).toEqual(['root', 'c1', 'c2'])
  })

  it('sorts an unanchored LOCAL (error) bubble after server roots, never above the chain', () => {
    const s1 = msg({ id: 's1' })
    const s2 = msg({ id: 's2', prevId: 's1' })
    const err = msg({ id: 'err', role: 'error', isLocal: true, prevId: '' })
    expect(ids(orderMessages([err, s1, s2]))).toEqual(['s1', 's2', 'err'])
  })

  it('does not drop a row whose prevId points outside the held window (dangling parent)', () => {
    const orphan = msg({ id: 'orphan', prevId: 'not-held' })
    const other = msg({ id: 'other' })
    const ordered = orderMessages([orphan, other])
    expect(ordered).toHaveLength(2)
    expect(new Set(ids(ordered))).toEqual(new Set(['orphan', 'other']))
  })

  it('is cycle-safe (prevId loop cannot drop or hang)', () => {
    const a = msg({ id: 'a', prevId: 'b' })
    const b = msg({ id: 'b', prevId: 'a' })
    const ordered = orderMessages([a, b])
    expect(ordered).toHaveLength(2)
    expect(new Set(ids(ordered))).toEqual(new Set(['a', 'b']))
  })

  it('assigns contiguous seqs matching the output order', () => {
    const ordered = orderMessages([
      msg({ id: 'l', isLocal: true }),
      msg({ id: 'a' }),
      msg({ id: 'b', prevId: 'a' }),
    ])
    expect(ordered.map(m => m.seq)).toEqual([0, 1, 2])
  })

  it('does not mutate the input array or its elements', () => {
    const input = [
      msg({ id: 'a', seq: 99 }),
      msg({ id: 'l', isLocal: true, seq: 0 }),
    ]
    const snapshot = input.map(m => ({ id: m.id, seq: m.seq }))
    orderMessages(input)
    expect(input.map(m => ({ id: m.id, seq: m.seq }))).toEqual(snapshot)
  })
})

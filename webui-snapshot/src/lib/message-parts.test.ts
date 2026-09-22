// Pure part-transform unit tests — the trickiest streaming logic (idempotent
// inserts, delta accumulation, tool-result folding) with no store/transport in
// the way.
import { describe, expect, it } from 'vitest'
import {
  addToolPartIn,
  appendDeltaTo,
  appendToolInputTo,
  applyToolResultTo,
  ensurePartIn,
  filePartFrom,
  startToolPartIn,
} from './message-parts'
import type { ChatPart } from './models'

const text = (id: string, t: string): ChatPart => ({
  id,
  type: 'text',
  text: t,
  tool: '',
})

describe('ensurePartIn', () => {
  it('appends an empty part when absent', () => {
    const out = ensurePartIn([], 'p1', 'text')
    expect(out).toEqual([{ id: 'p1', type: 'text', text: '', tool: '' }])
  })

  it('is idempotent by id (returns the SAME array reference)', () => {
    const parts = [text('p1', 'hi')]
    expect(ensurePartIn(parts, 'p1', 'text')).toBe(parts)
  })
})

describe('appendDeltaTo', () => {
  it('accumulates onto an existing part', () => {
    const out = appendDeltaTo([text('p1', 'ab')], 'p1', 'cd', false)
    expect(out[0]!.text).toBe('abcd')
  })

  it('creates the part when the delta arrives first (replay reorder)', () => {
    const out = appendDeltaTo([], 'p1', 'hi', false)
    expect(out).toEqual([text('p1', 'hi')])
  })

  it('creates a reasoning part with the reasoning flag', () => {
    const out = appendDeltaTo([], 'r1', 'think', true)
    expect(out[0]!.type).toBe('reasoning')
  })

  it('does not mutate the input array/part', () => {
    const parts = [text('p1', 'ab')]
    appendDeltaTo(parts, 'p1', 'cd', false)
    expect(parts[0]!.text).toBe('ab')
  })
})

describe('startToolPartIn', () => {
  it('creates a running tool part with an empty inputText', () => {
    const out = startToolPartIn([], 'tc1', 'web.search')
    expect(out[0]).toMatchObject({
      id: 'tc1',
      type: 'tool',
      tool: 'web.search',
      state: { status: 'running', title: 'web.search', inputText: '' },
    })
  })

  it('is idempotent by id', () => {
    const parts = startToolPartIn([], 'tc1', 'a')
    expect(startToolPartIn(parts, 'tc1', 'b')).toBe(parts)
  })
})

describe('appendToolInputTo', () => {
  it('accumulates streamed argument JSON', () => {
    const parts = startToolPartIn([], 'tc1', 'x')
    const out = appendToolInputTo(
      appendToolInputTo(parts, 'tc1', '{"q":'),
      'tc1',
      '"x"}',
    )
    expect(out[0]!.state?.inputText).toBe('{"q":"x"}')
  })

  it('leaves other parts untouched', () => {
    const parts = [text('p1', 'a'), ...startToolPartIn([], 'tc1', 'x')]
    const out = appendToolInputTo(parts, 'tc1', 'z')
    expect(out[0]).toBe(parts[0])
  })
})

describe('addToolPartIn', () => {
  it('inserts a tool part with the parsed input map', () => {
    const out = addToolPartIn([], 'tc1', 'web.search', { q: 'x' })
    expect(out[0]!.state).toMatchObject({
      status: 'running',
      input: { q: 'x' },
    })
  })

  it('replaces an existing part in place', () => {
    const parts = startToolPartIn([text('p1', 'a')], 'tc1', 'x')
    const out = addToolPartIn(parts, 'tc1', 'web.search', { q: 1 })
    expect(out).toHaveLength(2)
    expect(out[1]!.tool).toBe('web.search')
  })

  it('coerces non-object input to null', () => {
    const out = addToolPartIn([], 'tc1', 'x', 'not-an-object')
    expect(out[0]!.state?.input).toBeNull()
  })
})

describe('applyToolResultTo', () => {
  it('marks complete and stores a string output', () => {
    const parts = startToolPartIn([], 'tc1', 'x')
    const out = applyToolResultTo(parts, 'tc1', 'found 1')
    expect(out[0]!.state).toMatchObject({
      status: 'complete',
      output: 'found 1',
    })
  })

  it('pretty-prints object results', () => {
    const out = applyToolResultTo(startToolPartIn([], 'tc1', 'x'), 'tc1', {
      a: 1,
    })
    expect(out[0]!.state?.output).toBe('{\n  "a": 1\n}')
  })

  it('marks error and keeps the message', () => {
    const out = applyToolResultTo(
      startToolPartIn([], 'tc1', 'x'),
      'tc1',
      null,
      {
        errorMsg: 'kaput',
      },
    )
    expect(out[0]!.state).toMatchObject({ status: 'error', error: 'kaput' })
  })

  it('preserves title/input and folds extras', () => {
    const parts = startToolPartIn([], 'tc1', 'x')
    parts[0]!.state!.title = 'edited'
    const out = applyToolResultTo(parts, 'tc1', 'ok', {
      changeId: 'c1',
      additions: 3,
      deletions: 1,
    })
    expect(out[0]!.state).toMatchObject({
      title: 'edited',
      changeId: 'c1',
      additions: 3,
      deletions: 1,
    })
  })
})

describe('filePartFrom', () => {
  it('builds a file part from a file event', () => {
    const p = filePartFrom({
      code: 'abc',
      name: 'cat.png',
      mediaType: 'image/png',
      size: 42,
      width: 10,
      height: 20,
      durationMs: 5,
      thumbCode: 'th',
      thumbhash: 'hh',
    })
    expect(p).toMatchObject({
      id: 'fabc',
      type: 'file',
      code: 'abc',
      name: 'cat.png',
      mime: 'image/png',
      size: 42,
      width: 10,
      height: 20,
      durationMs: 5,
      thumbCode: 'th',
      thumbhash: 'hh',
    })
  })

  it('accepts snake_case duration/thumb fallbacks', () => {
    const p = filePartFrom({ code: 'x', duration_ms: 9, thumb_code: 't' })
    expect(p).toMatchObject({ durationMs: 9, thumbCode: 't' })
  })

  it('returns null without a code', () => {
    expect(filePartFrom({})).toBeNull()
    expect(filePartFrom({ code: '' })).toBeNull()
  })
})

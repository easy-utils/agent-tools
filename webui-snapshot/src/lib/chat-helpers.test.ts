// Pure chat-helper unit tests — model option/variant resolution and the
// compact token/elapsed formatters.
import { describe, expect, it } from 'vitest'
import {
  buildModelOptions,
  fmtContext,
  fmtElapsed,
  variantsFor,
} from './chat-helpers'
import type { ModelInfo } from './models'

function model(
  id: string,
  providerId: string,
  variants: ModelInfo['variants'] = [],
): ModelInfo {
  return { id, name: id, providerId, variants }
}

describe('buildModelOptions', () => {
  it('maps every model to its canonical ref', () => {
    const opts = buildModelOptions([model('a', 'p1'), model('b', 'p2')], '')
    expect(opts.map(o => o.value)).toEqual(['p1/a', 'p2/b'])
  })

  it('prepends a missing selected ref so it still shows', () => {
    const opts = buildModelOptions([model('a', 'p1')], 'p9/gone')
    expect(opts[0]).toEqual({ value: 'p9/gone', label: 'p9/gone' })
    expect(opts).toHaveLength(2)
  })

  it('does not duplicate a selected ref that exists', () => {
    const opts = buildModelOptions([model('a', 'p1')], 'p1/a')
    expect(opts).toHaveLength(1)
  })
})

describe('variantsFor', () => {
  it('returns the variants of the selected model', () => {
    const v = [{ id: 'low', name: 'Low', description: '' }]
    const out = variantsFor([model('a', 'p1', v), model('b', 'p2')], 'p1/a')
    expect(out).toEqual(v)
  })

  it('returns [] when nothing matches', () => {
    expect(variantsFor([model('a', 'p1')], 'p2/b')).toEqual([])
  })
})

describe('fmtContext', () => {
  it('formats across magnitudes', () => {
    expect(fmtContext(0)).toBe('')
    expect(fmtContext(-5)).toBe('')
    expect(fmtContext(850)).toBe('0.8k')
    expect(fmtContext(12_000)).toBe('12k')
    expect(fmtContext(1_500_000)).toBe('1.5M')
  })
})

describe('fmtElapsed', () => {
  it('formats m:ss', () => {
    expect(fmtElapsed(0)).toBe('0:00')
    expect(fmtElapsed(65_000)).toBe('1:05')
    expect(fmtElapsed(600_000)).toBe('10:00')
  })
})

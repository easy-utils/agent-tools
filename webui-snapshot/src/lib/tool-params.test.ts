// parseToolParams tests — JSON-Schema → tool-parameter tree, including the
// nested object/array recursion.
import { describe, expect, it } from 'vitest'
import { parseToolParams } from './tool-params'

describe('parseToolParams', () => {
  it('returns [] for a missing/empty schema', () => {
    expect(parseToolParams(null)).toEqual([])
    expect(parseToolParams(undefined)).toEqual([])
    expect(parseToolParams({})).toEqual([])
    expect(parseToolParams({ properties: 'nope' })).toEqual([])
  })

  it('parses scalar properties with required set membership', () => {
    const out = parseToolParams({
      type: 'object',
      properties: {
        q: { type: 'string', description: 'query' },
        n: { type: 'number', default: 3 },
        mode: { type: 'string', enum: ['a', 'b'] },
      },
      required: ['q'],
    })
    expect(out.map(p => p.name)).toEqual(['q', 'n', 'mode'])
    expect(out[0]).toMatchObject({
      type: 'string',
      description: 'query',
      required: true,
    })
    expect(out[1]!.defaultValue).toBe('3')
    expect(out[1]!.required).toBe(false)
    expect(out[2]!.enumValues).toEqual(['a', 'b'])
  })

  it('recurses into nested object properties', () => {
    const out = parseToolParams({
      type: 'object',
      properties: {
        filter: {
          type: 'object',
          properties: { tag: { type: 'string' } },
        },
      },
    })
    expect(out[0]!.children.map(c => c.name)).toEqual(['tag'])
  })

  it('recurses into array-of-object items', () => {
    const out = parseToolParams({
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
          },
        },
      },
    })
    expect(out[0]!.type).toBe('array')
    expect(out[0]!.children[0]).toMatchObject({ name: 'id', required: true })
  })

  it('defaults the type to object and skips non-object property values', () => {
    const out = parseToolParams({
      properties: {
        a: { description: 'x' },
        bad: null,
        alsoBad: 'string',
      },
    })
    expect(out.map(p => p.name)).toEqual(['a'])
    expect(out[0]!.type).toBe('object')
  })
})

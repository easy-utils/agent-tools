// Local mirror JSON codec tests — round-trips and the exact key shapes the
// Flutter/Drift store reads (snake_case for a few fields).
import { describe, expect, it } from 'vitest'
import {
  chatPartFromJson,
  fileFromJson,
  fileToJson,
  messagePartToJson,
  partToJson,
  toolStateFromJson,
  toolStateToJson,
} from './local-codecs'
import type { ChatPart } from './models'

describe('toolState codec', () => {
  it('round-trips a full tool state, keeping snake_case keys', () => {
    const state: NonNullable<ChatPart['state']> = {
      status: 'complete',
      title: 'web.search',
      input: { q: 'x' },
      output: 'found',
      error: null,
      data: { n: 1 },
      changeId: 'c1',
      diff: '+-',
      additions: 2,
      deletions: 1,
    }
    const j = toolStateToJson(state)
    expect(j['change_id']).toBe('c1')
    expect(toolStateFromJson(j)).toEqual(state)
  })

  it('omits unset fields', () => {
    expect(toolStateToJson({ status: '', title: '' })).toEqual({})
  })

  it('returns null for a null/undefined blob', () => {
    expect(toolStateFromJson(null)).toBeNull()
    expect(toolStateFromJson(undefined)).toBeNull()
  })
})

describe('chatPart codec', () => {
  it('round-trips a file part', () => {
    const p: ChatPart = {
      id: 'p1',
      type: 'file',
      text: '',
      tool: '',
      code: 'abc',
      name: 'a.png',
      mime: 'image/png',
      size: 12,
    }
    expect(chatPartFromJson(partToJson(p))).toEqual({ ...p, state: null })
  })

  it('round-trips a text part with a tool state', () => {
    const p: ChatPart = {
      id: 'p2',
      type: 'tool',
      text: '',
      tool: 't',
      state: { status: 'running', title: 't', inputText: '{}' },
    }
    const back = chatPartFromJson(partToJson(p))
    expect(back.state?.status).toBe('running')
  })

  it('defaults missing fields safely', () => {
    expect(chatPartFromJson({})).toMatchObject({
      id: '',
      type: '',
      text: '',
      tool: '',
      state: null,
    })
  })
})

describe('messagePart codec', () => {
  it('carries tool_call_id as snake_case', () => {
    const j = messagePartToJson({
      id: 'p1',
      type: 'tool',
      toolCallId: 'tc1',
      text: 'x',
    })
    expect(j['tool_call_id']).toBe('tc1')
  })
})

describe('file codec', () => {
  it('round-trips an uploaded-file record', () => {
    const f = {
      code: 'c1',
      name: 'a.txt',
      mime: 'text/plain',
      size: 3,
      localPath: '',
      uploadState: 'done' as const,
      deduped: false,
      sha256: null,
    }
    expect(fileFromJson(fileToJson(f))).toMatchObject({
      code: 'c1',
      name: 'a.txt',
      mime: 'text/plain',
      size: 3,
      uploadState: 'done',
    })
  })

  it('defaults uploadState to done', () => {
    expect(fileFromJson({ code: 'x' }).uploadState).toBe('done')
  })
})

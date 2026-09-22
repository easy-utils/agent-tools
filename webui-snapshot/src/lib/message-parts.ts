// Pure part transformations — every ChatPart[] edit the stream needs, with no
// runes and no store state. MessageStore wraps these with setMsg/streamingId;
// the event router uses `filePartFrom` directly. Keeping them pure makes the
// trickiest streaming logic unit-testable in isolation.
import { pretty } from './message-mapping'
import type { ChatPart, ToolState } from './models'

/** Extra fields a tool result can carry, mirrored from the wire. */
export interface ToolResultExtra {
  errorMsg?: string
  changeId?: string
  diff?: string
  additions?: number
  deletions?: number
  data?: Record<string, unknown>
}

/** Add an empty text/reasoning part if absent (idempotent by id). */
export function ensurePartIn(
  parts: ChatPart[],
  partId: string,
  type: string,
): ChatPart[] {
  return parts.some(p => p.id === partId)
    ? parts
    : [...parts, { id: partId, type, text: '', tool: '' }]
}

/** Append streamed text to a part, creating it if the delta arrives first. */
export function appendDeltaTo(
  parts: ChatPart[],
  partId: string,
  delta: string,
  reasoning: boolean,
): ChatPart[] {
  const pidx = parts.findIndex(p => p.id === partId)
  const next = [...parts]
  if (pidx >= 0) {
    next[pidx] = { ...next[pidx]!, text: next[pidx]!.text + delta }
  } else {
    next.push({
      id: partId,
      type: reasoning ? 'reasoning' : 'text',
      text: delta,
      tool: '',
    })
  }
  return next
}

/** Create the tool part as soon as argument streaming begins (idempotent). */
export function startToolPartIn(
  parts: ChatPart[],
  partId: string,
  name: string,
): ChatPart[] {
  if (parts.some(p => p.id === partId)) return parts
  const state: ToolState = { status: 'running', title: name, inputText: '' }
  return [...parts, { id: partId, type: 'tool', text: '', tool: name, state }]
}

/** Accumulate streamed tool-argument JSON for the live preview. */
export function appendToolInputTo(
  parts: ChatPart[],
  partId: string,
  delta: string,
): ChatPart[] {
  return parts.map(p => {
    if (p.id !== partId) return p
    const old: ToolState = p.state ?? { status: '', title: '' }
    return {
      ...p,
      state: { ...old, inputText: (old.inputText ?? '') + delta },
    }
  })
}

/** Insert/replace a tool part with its complete `input` payload. */
export function addToolPartIn(
  parts: ChatPart[],
  partId: string,
  name: string,
  input: unknown,
): ChatPart[] {
  const asMap =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : null
  const state: ToolState = { status: 'running', title: name, input: asMap }
  const part: ChatPart = {
    id: partId,
    type: 'tool',
    text: '',
    tool: name,
    state,
  }
  const next = [...parts]
  const pidx = next.findIndex(p => p.id === partId)
  if (pidx >= 0) next[pidx] = part
  else next.push(part)
  return next
}

/** Fold a tool result (string/JSON/null) plus extras into the part's state. */
export function applyToolResultTo(
  parts: ChatPart[],
  partId: string,
  result: unknown,
  extra: ToolResultExtra = {},
): ChatPart[] {
  return parts.map(p => {
    if (p.id !== partId) return p
    const old = p.state ?? { status: '', title: '' }
    const output =
      typeof result === 'string'
        ? result
        : result == null
          ? null
          : pretty(result)
    return {
      ...p,
      state: {
        status: extra.errorMsg != null ? 'error' : 'complete',
        title: old.title,
        error: extra.errorMsg ?? old.error ?? null,
        input: old.input ?? null,
        output: output ?? old.output ?? null,
        data: extra.data ?? old.data ?? null,
        changeId: extra.changeId ?? old.changeId ?? null,
        diff: extra.diff ?? old.diff ?? null,
        additions: extra.additions ?? old.additions ?? null,
        deletions: extra.deletions ?? old.deletions ?? null,
      } satisfies ToolState,
    }
  })
}

/** Build the file part for a streamed `file`/`reasoning-file` event. Returns
 *  null when the event carries no usable code. */
export function filePartFrom(params: Record<string, unknown>): ChatPart | null {
  const code = params['code'] as string | undefined
  if (code == null || code === '') return null
  return {
    id: `f${code}`,
    type: 'file',
    text: '',
    tool: '',
    code,
    name: (params['name'] as string | undefined) ?? null,
    mime: (params['mediaType'] as string | undefined) ?? null,
    size: params['size'] != null ? Number(params['size']) : null,
    width: params['width'] != null ? Number(params['width']) : null,
    height: params['height'] != null ? Number(params['height']) : null,
    durationMs:
      params['durationMs'] != null
        ? Number(params['durationMs'])
        : params['duration_ms'] != null
          ? Number(params['duration_ms'])
          : null,
    thumbCode:
      (params['thumbCode'] as string | undefined) ??
      (params['thumb_code'] as string | undefined) ??
      null,
    thumbhash: (params['thumbhash'] as string | undefined) ?? null,
  }
}

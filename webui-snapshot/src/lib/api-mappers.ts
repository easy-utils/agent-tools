// Pure protobuf → UI-model mappers for the agent API, plus the per-file
// ingest uploader and its JSON helpers. No client state — AgentApi composes
// these, and they are independently unit-testable.
import {
  IngestFileRequestSchema,
  IngestFileResponseSchema,
} from '@abcp/agent-sdk'
import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import type { Message, MessagePart, Session } from './models'

/** bigint | number | null → number (codegenv2 encodes int64 as bigint). */
export const n = (v: bigint | number | undefined | null): number =>
  v == null ? 0 : typeof v === 'bigint' ? Number(v) : v

export function decodeJson(data: string): Record<string, unknown> {
  if (!data) return {}
  try {
    const v = JSON.parse(data)
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** google.protobuf.Value (kind oneof) → plain JSON value. */
export function valueToJson(v: unknown): unknown {
  if (!v || typeof v !== 'object') return null
  const k = (v as { kind?: { case?: string; value?: unknown } }).kind
  if (!k?.case) return null
  switch (k.case) {
    case 'nullValue':
      return null
    case 'numberValue':
    case 'stringValue':
    case 'boolValue':
      return k.value
    case 'listValue':
      return ((k.value as { values?: unknown[] })?.values ?? []).map(
        valueToJson,
      )
    case 'structValue':
      return structToJson(k.value)
    default:
      return null
  }
}

function structToJson(v: unknown): Record<string, unknown> {
  const fields = (v as { fields?: Record<string, unknown> })?.fields
  if (!fields) return {}
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(fields)) out[k] = valueToJson(val)
  return out
}

export function sessionFromPb(s: import('@abcp/agent-sdk').Session): Session {
  return {
    id: s.name,
    org: s.org,
    repo: s.repo,
    branch: s.branch,
    model: s.model,
    variant: s.variant,
    preset: s.preset,
    tipId: s.tipId || undefined,
    maxTurns: s.maxTurns || undefined,
    systemPrompt: s.systemPrompt || undefined,
    locale: s.locale || undefined,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    totalTokens: s.totalTokens,
    lastInputTokens: s.lastInputTokens,
    lastOutputTokens: s.lastOutputTokens,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    unreadCount: s.unreadCount,
    lastMessageAt: s.lastMessageAt,
    lastMessagePreview: s.lastMessagePreview,
    messageSeq: s.messageSeq,
    group: s.group,
  }
}

type PbPart = {
  id: string
  messageId: string
  type: string
  data: string
}

type PbMessage = {
  id: string
  role: string
  createdAt: string
  prevId: string
  source: string
  parts: PbPart[]
}

export function messageFromPb(m: PbMessage): Message {
  // Pair each tool call with its result (tool_use_id) so history renders one
  // tool card per call — matching the live stream shape.
  const decoded = m.parts.map(p => [p, decodeJson(p.data)] as const)
  const results: Record<string, Record<string, unknown>> = {}
  for (const [p, d] of decoded) {
    if (p.type === 'tool_result') {
      const id = d['tool_use_id'] as string | undefined
      if (id) results[id] = d
    }
  }
  const parts: MessagePart[] = []
  for (const [p, d] of decoded) {
    switch (p.type) {
      case 'text':
        parts.push({
          id: p.id,
          type: 'text',
          text: (d['text'] as string) || '',
        })
        break
      case 'reasoning':
        parts.push({
          id: p.id,
          type: 'reasoning',
          text: (d['text'] as string) || '',
        })
        break
      case 'summary':
      case 'compaction':
        parts.push({
          id: p.id,
          type: 'compaction',
          text: (d['summary'] as string) || '',
        })
        break
      case 'file':
        parts.push({
          id: p.id,
          type: 'file',
          code: (d['code'] as string) || '',
          name: (d['name'] as string) || '',
          mime: d['mime'] as string | undefined,
          size: d['size'] != null ? Number(d['size']) : undefined,
          width: d['width'] != null ? Number(d['width']) : undefined,
          height: d['height'] != null ? Number(d['height']) : undefined,
          durationMs:
            d['duration_ms'] != null
              ? Number(d['duration_ms'])
              : d['durationMs'] != null
                ? Number(d['durationMs'])
                : undefined,
          thumbCode:
            (d['thumb_code'] as string | undefined) ??
            (d['thumbCode'] as string | undefined),
          thumbhash: (d['thumbhash'] as string | undefined) ?? undefined,
        })
        break
      case 'tool': {
        const callId = (d['id'] as string) || p.messageId
        const res = results[callId]
        const content = res?.['content']
        parts.push({
          id: p.id,
          type: 'tool',
          tool: (d['name'] as string) || '',
          toolCallId: callId,
          state: {
            status: res ? 'complete' : 'running',
            title: (d['name'] as string) || '',
            input: (d['input'] as Record<string, unknown>) || null,
            output: typeof content === 'string' ? content : null,
            data: (res?.['metadata'] as Record<string, unknown>) || null,
          },
        })
        break
      }
      case 'tool_result': {
        const id = (d['tool_use_id'] as string) || p.messageId
        if (results[id] && m.parts.some(q => q.type === 'tool')) break
        const content = d['content']
        parts.push({
          id: p.id,
          type: 'tool',
          tool: '',
          toolCallId: id,
          state: {
            status: 'complete',
            title: '',
            output: typeof content === 'string' ? content : null,
          },
        })
        break
      }
    }
  }
  return {
    id: m.id,
    role: m.role,
    createdAt: m.createdAt || null,
    prevId: m.prevId,
    source: m.source,
    parts,
  }
}

/**
 * Connect-unary POST of a pre-serialised protobuf message with upload
 * progress. `Content-Type: application/proto` + a bare message body is exactly
 * what the Connect binary unary protocol is; success returns the response
 * message (also bare protobuf), a Connect error is surfaced as an Error.
 *
 * Falls back to `fallback()` when XHR progress is unusable (no
 * XMLHttpRequest, or the transport refuses the hand-rolled request), so the
 * upload itself can never regress just because progress is unavailable.
 */
export function uploadIngest(
  baseUrl: string,
  token: string,
  body: Uint8Array,
  onProgress: ((done: number, total: number) => void) | undefined,
  fallback: () => Promise<{ code: string; mime: string }>,
): Promise<{ code: string; mime: string }> {
  if (typeof XMLHttpRequest === 'undefined' || onProgress === undefined) {
    return fallback()
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    const useFallback = () => {
      if (settled) return
      settled = true
      fallback().then(resolve, reject)
    }
    try {
      xhr.open('POST', `${baseUrl}/agent.v1.AgentService/IngestFile`, true)
      xhr.responseType = 'arraybuffer'
      xhr.setRequestHeader('Content-Type', 'application/proto')
      xhr.setRequestHeader('Connect-Protocol-Version', '1')
      if (token !== '') xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    } catch {
      useFallback()
      return
    }
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(e.loaded, e.total)
    }
    xhr.onerror = () => useFallback()
    xhr.ontimeout = () => useFallback()
    xhr.onload = () => {
      if (settled) return
      if (xhr.status >= 200 && xhr.status < 300) {
        settled = true
        try {
          const msg = fromBinary(
            IngestFileResponseSchema,
            new Uint8Array(xhr.response as ArrayBuffer),
          )
          resolve({ code: msg.code, mime: msg.mime })
        } catch (e) {
          reject(e)
        }
        return
      }
      // A protocol-level refusal (auth/validation): surface it as an error
      // rather than silently retrying through the fallback transport.
      settled = true
      reject(
        new Error(
          `upload failed: HTTP ${xhr.status} ${
            xhr.response instanceof ArrayBuffer
              ? new TextDecoder().decode(new Uint8Array(xhr.response))
              : ''
          }`.trim(),
        ),
      )
    }
    // Copy into a plain ArrayBuffer to satisfy the XHR body types (TS models
    // Uint8Array's buffer as ArrayBufferLike, which may be a SharedArrayBuffer).
    xhr.send(body.slice().buffer)
  })
}

/** Serialise an IngestFile request to its binary Connect body. */
export function encodeIngestRequest(
  bytes: Uint8Array,
  name: string,
): Uint8Array {
  return toBinary(
    IngestFileRequestSchema,
    create(IngestFileRequestSchema, { data: bytes, name }),
  )
}

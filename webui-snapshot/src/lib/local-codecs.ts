// JSON codecs for the local sqlite mirror — the exact shapes the Flutter store
// writes (Drift parity). Pure functions: no DB handle, so they can be tested
// directly. LocalStore composes them.
import type { ChatPart, MessagePart, UploadedFile } from './models'

export function toolStateToJson(
  s: NonNullable<ChatPart['state']>,
): Record<string, unknown> {
  const j: Record<string, unknown> = {}
  if (s.status) j['status'] = s.status
  if (s.title) j['title'] = s.title
  if (s.error != null) j['error'] = s.error
  if (s.input != null) j['input'] = s.input
  if (s.output != null) j['output'] = s.output
  if (s.data != null) j['data'] = s.data
  if (s.changeId != null) j['change_id'] = s.changeId
  if (s.diff != null) j['diff'] = s.diff
  if (s.additions != null) j['additions'] = s.additions
  if (s.deletions != null) j['deletions'] = s.deletions
  return j
}

export function toolStateFromJson(
  j: Record<string, unknown> | null | undefined,
): ChatPart['state'] {
  if (!j) return null
  return {
    status: (j['status'] as string) || '',
    title: (j['title'] as string) || '',
    error: (j['error'] as string) ?? null,
    input: (j['input'] as Record<string, unknown>) ?? null,
    output: (j['output'] as string) ?? null,
    data: (j['data'] as Record<string, unknown>) ?? null,
    changeId: (j['change_id'] as string) ?? null,
    diff: (j['diff'] as string) ?? null,
    additions: (j['additions'] as number) ?? null,
    deletions: (j['deletions'] as number) ?? null,
  }
}

export function partToJson(p: ChatPart): Record<string, unknown> {
  const j: Record<string, unknown> = { id: p.id, type: p.type }
  if (p.text) j['text'] = p.text
  if (p.tool) j['tool'] = p.tool
  if (p.state) j['state'] = toolStateToJson(p.state)
  if (p.code != null) j['code'] = p.code
  if (p.name != null) j['name'] = p.name
  if (p.mime != null) j['mime'] = p.mime
  if (p.size != null) j['size'] = p.size
  return j
}

export function chatPartFromJson(j: Record<string, unknown>): ChatPart {
  return {
    id: (j['id'] as string) || '',
    type: (j['type'] as string) || '',
    text: (j['text'] as string) || '',
    tool: (j['tool'] as string) || '',
    state: toolStateFromJson(j['state'] as Record<string, unknown> | null),
    code: (j['code'] as string) ?? null,
    name: (j['name'] as string) ?? null,
    mime: (j['mime'] as string) ?? null,
    size: j['size'] != null ? Number(j['size']) : null,
  }
}

export function messagePartToJson(p: MessagePart): Record<string, unknown> {
  const j: Record<string, unknown> = { id: p.id, type: p.type }
  if (p.text != null) j['text'] = p.text
  if (p.tool != null) j['tool'] = p.tool
  if (p.toolCallId != null) j['tool_call_id'] = p.toolCallId
  if (p.state) j['state'] = toolStateToJson(p.state)
  if (p.code != null) j['code'] = p.code
  if (p.name != null) j['name'] = p.name
  if (p.mime != null) j['mime'] = p.mime
  if (p.size != null) j['size'] = p.size
  return j
}

export function fileToJson(a: UploadedFile): Record<string, unknown> {
  return {
    code: a.code,
    name: a.name,
    mime: a.mime,
    size: a.size,
    localPath: a.localPath,
    state: a.uploadState,
  }
}

export function fileFromJson(j: Record<string, unknown>): UploadedFile {
  return {
    code: (j['code'] as string) || '',
    name: (j['name'] as string) ?? null,
    mime: (j['mime'] as string) ?? null,
    size: j['size'] != null ? Number(j['size']) : null,
    localPath: (j['localPath'] as string) || '',
    uploadState: (j['state'] as UploadedFile['uploadState']) || 'done',
    deduped: false,
    sha256: null,
  }
}

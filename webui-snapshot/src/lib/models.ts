/** Bundled fallback copy of the server capability matrix (canonical api
 * types only). Used until ListProvidersCatalog answers; the server response
 * overrides it. */
export const FALLBACK_API_TYPE_CAPABILITIES: Record<string, string[]> = {
  'openai-compatible': [
    'text',
    'embedding',
    'image',
    'speech',
    'transcription',
    'realtime',
  ],
  openai: ['text', 'embedding', 'image', 'speech', 'transcription', 'realtime'],
  anthropic: ['text'],
  deepseek: ['text'],
  google: ['text'],
  'vercel-compatible-gateway': [
    'text',
    'image',
    'video',
    'speech',
    'transcription',
    'embedding',
    'rerank',
    'realtime',
  ],
  cohere: ['text', 'rerank'],
}

/** The 8 first-class modalities, in section order. */
export const kModelCapabilities = [
  'text',
  'image',
  'video',
  'speech',
  'transcription',
  'embedding',
  'rerank',
  'realtime',
] as const

// Domain models — direct port of flutter/lib/models.dart (the subset the UI
// uses; legacy container/ops models are intentionally omitted).

export interface Session {
  id: string
  org: string
  repo: string
  branch: string
  /** Canonical model reference "provider_id/model_id". */
  model: string
  /** Selected reasoning variant id ('' = provider default). */
  variant: string
  preset: string
  tipId?: string
  maxTurns?: number
  systemPrompt?: string
  locale?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  lastInputTokens?: number
  lastOutputTokens?: number
  createdAt: string
  updatedAt: string
  unreadCount?: number
  lastMessageAt: string
  lastMessagePreview: string
  /** Monotonic server-owned counter; unread = messageSeq - readSeq. */
  messageSeq: number
  /** Generic grouping key (empty = ungrouped). A subsession records its
   *  parent's session name here. */
  group: string
}

export function sessionName(s: Session): string {
  return s.org ? `${s.org}:${s.repo}:${s.branch}` : s.id
}

// ---- messages ----

export interface ToolState {
  status: string // pending | running | complete | error
  title: string
  input?: Record<string, unknown> | null
  output?: string | null
  error?: string | null
  data?: Record<string, unknown> | null
  changeId?: string | null
  diff?: string | null
  additions?: number | null
  deletions?: number | null
  /** Raw streamed tool-argument JSON (tool-input-delta), shown live until the
   *  complete `input` arrives with `tool-call`. */
  inputText?: string | null
}

export interface MessagePart {
  id: string
  type: string // text | reasoning | tool | compaction | file | tool_result
  text?: string | null
  tool?: string | null
  toolCallId?: string | null
  state?: ToolState | null
  metadata?: Record<string, unknown> | null
  code?: string | null
  name?: string | null
  mime?: string | null
  size?: number | null
  // Server-derived media facts (may be absent until the agent's media probe
  // finishes, or for non-media files).
  width?: number | null
  height?: number | null
  durationMs?: number | null
  thumbCode?: string | null
  thumbhash?: string | null
}

export interface Message {
  id: string
  role: string
  parts: MessagePart[]
  createdAt?: string | null
  prevId: string
  /** ORIGIN of the message ('' for agent-authored rows): `user`,
   *  `session:{name}`, `system:{name}`, or extension-defined. */
  source: string
}

// ---- attachments ----

export interface UploadedFileSource {
  path: string
  name: string
  mimeType: string
  bytes?: Uint8Array | null
}

export type UploadState = 'idle' | 'uploading' | 'done' | 'error'

/** Server-side record for an uploaded file, or a LOCAL pending attachment. */
export interface UploadedFile {
  code: string
  name?: string | null
  mime?: string | null
  size?: number | null
  sha256?: string | null
  deduped: boolean
  localPath: string
  uploadState: UploadState
  error?: string | null
  /** Upload progress 0..100 while `uploadState === 'uploading'`; -1 when the
   *  total is not yet known. Byte-level (XHR upload progress), not a timer. */
  uploadPct?: number | null
}

export function isUploading(f: UploadedFile): boolean {
  return f.uploadState === 'uploading'
}
export function hasUploadError(f: UploadedFile): boolean {
  return f.uploadState === 'error'
}

export interface ChatDraft {
  text: string
  attachments: UploadedFile[]
}

// ---- chat streaming domain ----

export interface ChatPart {
  id: string
  type: string
  text: string
  tool: string
  state?: ToolState | null
  code?: string | null
  name?: string | null
  mime?: string | null
  size?: number | null
  width?: number | null
  height?: number | null
  durationMs?: number | null
  thumbCode?: string | null
  thumbhash?: string | null
}

/** A single produced-file descriptor, as emitted by tools in
 *  `data.files` and by the built-in media tools. */
export interface FileRef {
  code: string
  name?: string | null
  mime?: string | null
  size?: number | null
  width?: number | null
  height?: number | null
  durationMs?: number | null
  thumbCode?: string | null
  thumbhash?: string | null
  /** UI-only: a local object URL for a not-yet-uploaded attachment. When set
   *  the viewer uses it directly instead of fetching the code from the agent. */
  localUrl?: string | null
}

export interface ChatMessage {
  id: string
  role: string
  /** `sending` = optimistic user bubble awaiting the backend `message-added`
   *  event (left spinner, actions hidden). */
  status: 'sending' | 'streaming' | 'complete' | 'error'
  parts: ChatPart[]
  createdAt: string
  seq?: number | null
  /** Server chain pin; '' for local-only messages. */
  prevId: string
  /** Client-only bubble (optimistic user msg / streaming assistant). */
  isLocal: boolean
  /** ORIGIN of the message: `user`, `session:{name}`, `system:{name}`, or
   *  extension-defined. '' for agent-authored rows. */
  source: string
  /** Server-assigned id for an optimistic bubble, learned from the Prompt
   *  `accepted` response. Kept separate from `id` (the stable local key) so
   *  the optimistic bubble and its persisted copy can coexist until the
   *  backend `message-added` event lets `mergeServer` drop the former. */
  serverId?: string
}

// ---- mailbox ----

export interface MailboxEntry {
  id: string
  msgType: string
  /** ORIGIN of the message: `user`, `session:{name}`, `system:{name}`, or an
   *  extension-defined value. */
  source: string
  payload: string
  effectiveAt?: string | null
  status: string
  createdAt: string
  consumedAt?: string | null
}

// ---- presets / tools ----

export interface Preset {
  id: string
  systemPrompt: string
  systemPromptI18n: Record<string, string>
  tools: string[]
  maxTurns: number
  isSystem: boolean
}

export interface ToolConfigField {
  key: string
  label: string
  type: string // select-provider | select-model | text | number
  placeholder: string
  dependsOnProvider?: string | null
}

export interface ToolConfig {
  name: string
  type: string // string | number | boolean | enum | json
  /** `value` (ordinary knob) or `model` (a provider_id/model_id reference). */
  kind: string
  /** When kind == 'model': the modality the reference must match. */
  capability: string
  enumValues: string[]
  defaultValue?: unknown
  description: string
  scope: string // global | session
}

export interface ToolInfo {
  name: string
  description: string
  category: string
  parameters?: Record<string, unknown> | null
  configFields?: ToolConfigField[] | null
  config?: ToolConfig[] | null
  requiredConfig: string[]
}

// ---- providers / models ----

export interface ProviderModel {
  id: string
  name: string
  /** >0 text model; 0 = multimodal (gateway superset). */
  contextLimit?: number | null
  modelType: string
}

export interface ProviderInfo {
  providerId: string
  /** The single modality this provider serves (semantic grouping). */
  capability: string
  apiType: string
  baseUrl: string
  apiKey: string
  headers?: Record<string, string> | null
  models: ProviderModel[]
}

export interface ProviderDraft {
  originalId: string | null
  id: string
  capability: string
  apiType: string
  baseUrl: string
  apiKey: string
  models: ProviderModel[]
}

export function draftFromProvider(p: ProviderInfo): ProviderDraft {
  return {
    originalId: p.providerId,
    id: p.providerId,
    capability: p.capability,
    apiType: p.apiType,
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    models: [...p.models],
  }
}

export interface ModelVariantInfo {
  id: string
  name: string
  description: string
}

export interface ModelInfo {
  id: string
  name: string
  providerId: string
  contextLimit?: number | null
  reasoning?: boolean
  toolCall?: boolean
  variants: ModelVariantInfo[]
}

/** The canonical "provider_id/model_id" reference for a model row. */
export function modelRefOf(m: ModelInfo): string {
  return m.providerId ? `${m.providerId}/${m.id}` : m.id
}

// ---- backends (saved connections) ----

export interface BackendCfg {
  name: string
  baseUrl: string
  token: string
  /** Human username (tenant name) resolved from the token at connect/switch
   *  time via AgentService.GetIdentity. Absent for legacy entries. */
  username?: string
}

/** The caller's resolved identity (from its bearer token). */
export interface Identity {
  tenant: string
  tenantName: string
  role: 'tenant' | 'admin'
}

/** Display name for a connection. The webui is served same-origin with the
 *  agent, so the host no longer distinguishes accounts; fall back to the host
 *  (useful for the `?base=` dev override) and let callers prefer a custom name. */
export function backendNameFor(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname
  } catch {
    return baseUrl
  }
}

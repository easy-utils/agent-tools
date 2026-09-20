// AgentApi — a faithful port of flutter/lib/api.dart over the latest
// @abcp/agent-sdk (codegenv2: Struct→JsonObject, int64→bigint).
import type { AgentClient } from './agent'
import { createAgentClient } from './agent'
import { fireAuthExpired, isAuthError, makeStreamEvent, type StreamEvent } from './events'
import type {
  Identity,
  MailboxEntry,
  Message,
  MessagePart,
  ModelInfo,
  Preset,
  ProviderInfo,
  ProviderModel,
  Session,
  ToolConfig,
  ToolConfigField,
  ToolInfo,
  ToolState,
  UploadedFile,
  UploadedFileSource,
} from './models'
import { modelRefOf } from './models'

const n = (v: bigint | number | undefined | null): number =>
  v == null ? 0 : typeof v === 'bigint' ? Number(v) : v

function decodeJson(data: string): Record<string, unknown> {
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

// ---- pb → model mappers (agent native) ----

/** google.protobuf.Value (kind oneof) → plain JSON value. */
function valueToJson(v: unknown): unknown {
  if (!v || typeof v !== 'object') return null
  const k = (v as { kind?: { case?: string; value?: unknown } }).kind
  if (!k || !k.case) return null
  switch (k.case) {
    case 'nullValue':
      return null
    case 'numberValue':
    case 'stringValue':
    case 'boolValue':
      return k.value
    case 'listValue':
      return ((k.value as { values?: unknown[] })?.values ?? []).map(valueToJson)
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
        parts.push({ id: p.id, type: 'text', text: (d['text'] as string) || '' })
        break
      case 'reasoning':
        parts.push({ id: p.id, type: 'reasoning', text: (d['text'] as string) || '' })
        break
      case 'summary':
      case 'compaction':
        parts.push({ id: p.id, type: 'compaction', text: (d['summary'] as string) || '' })
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
          thumbCode: (d['thumb_code'] as string | undefined) ?? (d['thumbCode'] as string | undefined),
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
    parts,
  }
}

// ---- the facade ----

export interface AgentApiEvents {
  onAuthExpired?: (reason: 'expired' | 'addedUser') => void
}

export class AgentApi {
  readonly baseUrl: string
  readonly token: string
  private readonly _c: AgentClient

  private constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl
    this.token = token
    this._c = createAgentClient(baseUrl, token)
  }

  static async create(baseUrl: string, token: string): Promise<AgentApi> {
    // Web has no bundled CA (the browser trust store + CORS apply).
    return new AgentApi(baseUrl, token)
  }

  /** Wrap an RPC so 401/403 anywhere raises the global auth-expired dialog. */
  private async _guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      if (isAuthError(e)) fireAuthExpired('expired')
      throw e
    }
  }

  // ---- sessions ----

  async listSessions(): Promise<Session[]> {
    return await this._guard(async () => {
      const r = await this._c.listSessions({})
      return r.sessions.map(sessionFromPb)
    })
  }

  async createSession(params: Record<string, unknown>): Promise<Session> {
    // Only forward fields actually set: an empty string would be written
    // verbatim (the agent treats empty preset/model as "tenant default").
    const model = (params['model'] as string) || ''
    const variant = (params['variant'] as string) || ''
    const preset = (params['preset'] as string) || ''
    const org = (params['org'] as string) || ''
    const repo = (params['repo'] as string) || ''
    const branch = (params['branch'] as string) || ''
    const r = await this._c.createSession({
      name: (params['name'] as string) || '',
      ...(model ? { model } : {}),
      ...(variant ? { variant } : {}),
      ...(preset ? { preset } : {}),
      ...(org ? { org } : {}),
      ...(repo ? { repo } : {}),
      ...(branch ? { branch } : {}),
    })
    return {
      id: r.sessionName,
      model,
      variant,
      preset,
      org,
      repo,
      branch,
      createdAt: '',
      updatedAt: '',
      lastMessageAt: '',
      lastMessagePreview: '',
      messageSeq: 0,
      group: '',
    }
  }

  async getSession(id: string): Promise<Session> {
    const r = await this._c.getSession({ id })
    return r.session ? sessionFromPb(r.session) : emptySession('')
  }

  async deleteSession(id: string): Promise<void> {
    await this._c.deleteSession({ id })
  }

  async renameSession(id: string, name: string): Promise<Session> {
    const r = await this._c.rename({ id, name })
    return r.session ? sessionFromPb(r.session) : emptySession('')
  }

  async prompt(id: string, prompt: string, attachments: string[] = []): Promise<string> {
    // File codes MUST be forwarded as attachment refs; omitting them silently
    // drops every picked image / file / recording.
    for await (const ev of this._c.prompt({ id, prompt, attachments: attachments.map(code => ({ code })) })) {
      if (ev.event === 'accepted') {
        return ((ev.params as Record<string, unknown>)['message_id'] as string) || ''
      }
    }
    return ''
  }

  // ---- attachment upload / download ----

  async uploadFile(src: UploadedFileSource): Promise<UploadedFile> {
    const bytes = src.bytes
    if (!bytes || !bytes.length) throw new Error(`attachment has no bytes: ${src.name}`)
    // No mime is sent: the agent derives the content type from the bytes and
    // returns the authoritative value, which we adopt for local rendering.
    const r = await this._c.ingestFile({ data: bytes, name: src.name })
    return {
      code: r.code,
      name: src.name,
      mime: r.mime || src.mimeType,
      size: bytes.length,
      deduped: false,
      localPath: '',
      uploadState: 'done',
    }
  }

  async fetchFileBytes(code: string): Promise<Uint8Array> {
    const r = await this._c.getFile({ code })
    return r.data
  }

  /** Stream a file's bytes in order (GetFileStream, ConnectRPC). Yields chunks
   *  as they arrive so large media can render progressively. */
  async *streamFileBytes(code: string): AsyncGenerator<Uint8Array> {
    for await (const chunk of this._c.getFileStream({ code })) {
      if (chunk.data.length > 0) yield chunk.data
    }
  }

  /** Stream a file into a Blob, invoking `onProgress(done,total)` as it goes. */
  async streamFileBlob(
    code: string,
    mime: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Blob> {
    const parts: Uint8Array[] = []
    let done = 0
    let total = 0
    for await (const chunk of this._c.getFileStream({ code })) {
      parts.push(chunk.data)
      done += chunk.data.length
      total = Number(chunk.total)
      onProgress?.(done, total)
    }
    return new Blob(parts as BlobPart[], {
      type: mime || 'application/octet-stream',
    })
  }

  async fetchFileBlob(code: string): Promise<Blob> {
    const bytes = await this.fetchFileBytes(code)
    const meta = await this.fileHead(code)
    return new Blob([new Uint8Array(bytes)], { type: meta.contentType || 'application/octet-stream' })
  }

  async fileHead(code: string): Promise<{
    contentType: string | null
    length: number
    width?: number | null
    height?: number | null
    durationMs?: number | null
    thumbCode?: string | null
    thumbhash?: string | null
  }> {
    const r = await this._c.getFileMeta({ code })
    return {
      contentType: r.mime || null,
      length: Number(r.size),
      width: r.width ?? null,
      height: r.height ?? null,
      durationMs: r.durationMs != null ? Number(r.durationMs) : null,
      thumbCode: r.thumbCode ?? null,
      thumbhash: r.thumbhash ?? null,
    }
  }

  // ---- messages ----

  async messages(id: string, before?: string, limit = 30): Promise<[Message[], boolean]> {
    const r = await this._c.listMessages({ id, limit, before: before ?? '' })
    const msgs = r.messages.map(messageFromPb)
    return [msgs, msgs.length >= limit]
  }

  async messagesAfter(
    id: string,
    after: string,
    limit = 200,
  ): Promise<{ messages: Message[]; resync: boolean; tipId: string }> {
    const r = await this._c.listMessages({ id, limit, after })
    return {
      messages: r.messages.map(messageFromPb),
      resync: r.resync,
      tipId: r.tipId,
    }
  }

  // ---- session ops ----

  async switchModel(id: string, model: string, variant = ''): Promise<string> {
    await this._c.setModel({ id, model, variant })
    return model
  }

  async settings(id: string, settings: Record<string, unknown>): Promise<Session> {
    const maxTurns = settings['max_turns'] as number | undefined
    const model = (settings['model'] as string) || ''
    const preset = (settings['preset'] as string) || ''
    const r = await this._guard(() => this._c.updateSettings({
      id,
      ...(model ? { model } : {}),
      ...(preset ? { preset } : {}),
      systemPrompt: (settings['system_prompt'] as string) || '',
      locale: (settings['locale'] as string) || '',
      variant: (settings['variant'] as string) || '',
      ...(maxTurns && maxTurns > 0 ? { maxTurns } : {}),
    }))
    return r.session ? sessionFromPb(r.session) : emptySession('')
  }

  async fork(id: string, branch: string): Promise<Session> {
    const r = await this._guard(() => this._c.fork({ id, name: branch }))
    return r.session ? sessionFromPb(r.session) : emptySession('')
  }

  async revert(id: string, messageId?: string | null): Promise<void> {
    await this._c.undo({ id, messageId: messageId ?? '' })
  }

  async interrupt(id: string): Promise<boolean> {
    const r = await this._c.interrupt({ id })
    return r.ok
  }

  async compact(id: string): Promise<boolean> {
    const r = await this._c.compact({ id })
    return r.ok
  }

  async state(id: string): Promise<[string, unknown[]]> {
    const r = await this._c.state({ id })
    const st = (r.state ?? {}) as Record<string, unknown>
    return [(st['status'] as string) || 'idle', (st['parts'] as unknown[]) || []]
  }

  async mailbox(id: string): Promise<MailboxEntry[]> {
    const r = await this._c.mailbox({ id })
    return r.mailbox.map(m => ({
      id: m.id,
      msgType: m.msgType,
      payload: m.payload,
      effectiveAt: m.effectiveAt || null,
      status: m.status,
      createdAt: m.createdAt,
      consumedAt: m.consumedAt || null,
    }))
  }

  // ---- streams ----

  async *streamEvents(sessionId: string, since = ''): AsyncGenerator<StreamEvent> {
    for await (const e of this._c.watchSession({ id: sessionId, since })) {
      const params = (e.params ?? {}) as Record<string, unknown>
      const runId = params['run_id']
      yield makeStreamEvent(e.event, params, e.eid, typeof runId === 'string' ? runId : '')
    }
  }

  async *watchSessions(): AsyncGenerator<{
    snapshot: boolean
    upserts: Session[]
    removed: string[]
  }> {
    for await (const e of this._c.watchSessions({})) {
      yield {
        snapshot: e.snapshot,
        upserts: e.upserts.map(sessionFromPb),
        removed: [...e.removed],
      }
    }
  }

  // ---- config / providers / models / presets / tools ----

  async setToolConfigValue(extId: string, name: string, value: unknown): Promise<void> {
    await this._c.setExtensionConfig({
      extId,
      name,
      value: { kind: { case: 'stringValue', value: value == null ? '' : String(value) } },
    })
  }

  /** Server capability matrix (ListProvidersCatalog): canonical api type ->
   * capabilities a model of that type may declare. */
  async providerCatalog(): Promise<Record<string, string[]>> {
    const r = await this._guard(() => this._c.listProvidersCatalog({}))
    const out: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(r.apiTypes)) {
      out[k] = [...v.capabilities]
    }
    return out
  }

  async providers(): Promise<Record<string, ProviderInfo>> {
    const r = await this._guard(() => this._c.listProviders({}))
    const out: Record<string, ProviderInfo> = {}
    for (const p of r.providers) {
      out[p.providerId] = {
        providerId: p.providerId,
        capability: p.capability || 'text',
        apiType: p.apiType,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        headers: { ...p.headers },
        models: p.models.map(m => ({
          id: m.id,
          name: m.name || m.id,
          contextLimit: Number(m.contextLimit ?? 0),
          modelType: m.modelType,
        })),
      }
    }
    return out
  }

  async registerProvider(p: ProviderInfo): Promise<void> {
    await this._c.registerProvider({
      provider: {
        providerId: p.providerId,
        capability: p.capability,
        apiType: p.apiType,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        headers: p.headers ?? {},
        models: p.models.map(m => ({
          id: m.id,
          name: m.name,
          contextLimit: BigInt(m.contextLimit ?? 0),
          modelType: m.modelType,
        })),
      },
    })
  }

  async deleteProvider(pid: string): Promise<void> {
    await this._c.deleteProvider({ providerId: pid })
  }

  async testProvider(opts: {
    apiType: string
    baseUrl: string
    apiKey: string
    providerId?: string
    model?: string | null
    capability?: string
  }): Promise<{ ok: boolean; result: unknown }> {
    const r = await this._c.testProvider({
      apiType: opts.apiType,
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      providerId: opts.providerId ?? '',
      model: opts.model ?? '',
      capability: opts.capability ?? 'text',
    })
    return { ok: r.ok, result: r.result }
  }

  async models(providerId: string): Promise<ModelInfo[]> {
    if (!providerId) return []
    const r = await this._guard(() => this._c.listModels({ providerId }))
    return r.models.map(m => ({
      id: m.id,
      name: m.name,
      providerId,
      contextLimit: n(m.contextLimit),
      variants: m.variants.map(v => ({
        id: v.id,
        name: v.name,
        description: v.description,
      })),
    }))
  }

  async presets(locale?: string): Promise<Preset[]> {
    const r = await this._guard(() => this._c.listPresets({ locale: locale ?? '' }))
    return r.presets.map(p => ({
      id: p.id,
      systemPrompt: p.systemPrompt,
      systemPromptI18n: {},
      tools: [...p.tools],
      maxTurns: p.maxTurns,
      isSystem: p.isSystem,
    }))
  }

  async savePreset(p: Preset): Promise<void> {
    await this._c.upsertPreset({
      preset: {
        id: p.id,
        systemPrompt: p.systemPrompt,
        tools: [...p.tools],
        maxTurns: p.maxTurns,
      },
    })
  }

  async deletePreset(id: string): Promise<void> {
    await this._c.deletePreset({ id })
  }

  async tools(locale?: string): Promise<ToolInfo[]> {
    const r = await this._guard(() => this._c.listTools({ locale: locale ?? '' }))
    return r.tools.map(t => ({
      name: t.name,
      description: t.description,
      category: t.category,
      parameters: (t.parameters ?? null) as Record<string, unknown> | null,
      configFields: t.configFields.map(
        (c): ToolConfigField => ({
          key: c.name,
          label: c.description || c.name,
          type: c.type,
          placeholder: '',
        }),
      ),
      config: t.configFields.map(
        (c): ToolConfig => ({
          name: c.name,
          type: c.type,
          kind: c.kind || 'value',
          capability: c.capability,
          enumValues: [...c.enumValues],
          defaultValue: c.default ? valueToJson(c.default) : null,
          description: c.description,
          scope: c.scope,
        }),
      ),
      requiredConfig: [...t.requiredConfig],
    }))
  }

  async setConfigKey(key: string, value: string): Promise<void> {
    await this._c.setConfig({ key, value })
  }

  async config(key: string): Promise<string> {
    const r = await this._guard(() => this._c.getConfig({ key }))
    return r.value
  }

  async sessionLocale(id: string, locale: string): Promise<Session> {
    return this.settings(id, { locale })
  }

  async toolConfig(): Promise<Record<string, unknown>> {
    const r = await this._c.getToolConfig({})
    const values = (r.config?.values ?? {}) as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(values)) out[k] = valueToJson(v)
    return out
  }

  async health(): Promise<boolean> {
    const r = await this._c.health({})
    return r.ok
  }

  /** The caller's resolved identity (tenant id/name + role). */
  async identity(): Promise<Identity> {
    const r = await this._guard(() => this._c.getIdentity({}))
    return {
      tenant: r.tenant,
      tenantName: r.tenantName,
      role: r.role === 'admin' ? 'admin' : 'tenant',
    }
  }
}

export function emptySession(id: string): Session {
  return {
    id,
    org: '',
    repo: '',
    branch: '',
    model: '',
    variant: '',
    preset: '',
    createdAt: '',
    updatedAt: '',
    lastMessageAt: '',
    lastMessagePreview: '',
    messageSeq: 0,
    group: '',
  }
}

export { modelRefOf }
export type { ToolState }

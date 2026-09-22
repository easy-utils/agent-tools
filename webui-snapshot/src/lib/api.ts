// AgentApi — a faithful port of flutter/lib/api.dart over the latest
// @abcp/agent-sdk (codegenv2: Struct→JsonObject, int64→bigint).
//
// The pure pb↔model mappers and the XHR upload helper live in api-mappers.ts.

import type { AgentClient } from './agent'
import { createAgentClient } from './agent'
import {
  encodeIngestRequest,
  messageFromPb,
  n,
  sessionFromPb,
  uploadIngest,
  valueToJson,
} from './api-mappers'
import {
  fireAuthExpired,
  isAuthError,
  makeStreamEvent,
  type StreamEvent,
} from './events'
import type {
  Identity,
  MailboxEntry,
  Message,
  ModelInfo,
  Preset,
  ProviderInfo,
  Session,
  ToolConfig,
  ToolConfigField,
  ToolInfo,
  ToolState,
  UploadedFile,
  UploadedFileSource,
} from './models'
import { modelRefOf } from './models'

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

  async prompt(
    id: string,
    prompt: string,
    attachments: string[] = [],
  ): Promise<string> {
    // File codes MUST be forwarded as attachment refs; omitting them silently
    // drops every picked image / file / recording.
    for await (const ev of this._c.prompt({
      id,
      prompt,
      attachments: attachments.map(code => ({ code })),
    })) {
      if (ev.event === 'accepted') {
        return (
          ((ev.params as Record<string, unknown>)['message_id'] as string) || ''
        )
      }
    }
    return ''
  }

  // ---- attachment upload / download ----

  /**
   * Upload a file's bytes (IngestFile) reporting REAL byte-level progress.
   *
   * The Connect client has no upload-progress hook (fetch cannot report
   * request-body progress), so this issues the equivalent Connect-UNARY
   * request by hand with XMLHttpRequest: `Content-Type: application/proto`
   * plus the bare protobuf message body — byte-for-byte what
   * `createConnectTransport(useBinaryFormat: true)` sends for a unary call.
   * `xhr.upload.onprogress` then gives true `loaded/total` (including the
   * client's own send buffer), which is what makes the attachment tile's
   * "42%" honest rather than a fake timer. Falls back to the typed client
   * where XHR upload progress is unavailable.
   *
   * No mime is sent: the agent derives the authoritative type from the bytes.
   */
  async uploadFile(
    src: UploadedFileSource,
    onProgress?: (done: number, total: number) => void,
  ): Promise<UploadedFile> {
    const bytes = src.bytes
    if (!bytes?.length) throw new Error(`attachment has no bytes: ${src.name}`)
    const req = encodeIngestRequest(bytes, src.name)
    const out = await uploadIngest(
      this.baseUrl,
      this.token,
      req,
      onProgress,
      () => this._c.ingestFile({ data: bytes, name: src.name }),
    )
    return {
      code: out.code,
      name: src.name,
      mime: out.mime || src.mimeType,
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
    return new Blob([new Uint8Array(bytes)], {
      type: meta.contentType || 'application/octet-stream',
    })
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

  async messages(
    id: string,
    before?: string,
    limit = 30,
  ): Promise<[Message[], boolean]> {
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

  async settings(
    id: string,
    settings: Record<string, unknown>,
  ): Promise<Session> {
    const model = (settings['model'] as string) || ''
    const preset = (settings['preset'] as string) || ''
    const r = await this._guard(() =>
      this._c.updateSettings({
        id,
        ...(model ? { model } : {}),
        ...(preset ? { preset } : {}),
        locale: (settings['locale'] as string) || '',
        variant: (settings['variant'] as string) || '',
      }),
    )
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
    return [
      (st['status'] as string) || 'idle',
      (st['parts'] as unknown[]) || [],
    ]
  }

  /** One page of the mailbox, newest-first. `before` is the id of the oldest
   *  entry the caller already holds ('' = the newest page); `hasMore` says
   *  whether older entries remain. */
  async mailbox(
    id: string,
    before = '',
    limit = 0,
  ): Promise<{ entries: MailboxEntry[]; hasMore: boolean }> {
    const r = await this._c.mailbox({ id, before, limit })
    return {
      hasMore: r.hasMore,
      entries: r.mailbox.map(m => ({
        id: m.id,
        msgType: m.msgType,
        source: m.source,
        payload: m.payload,
        effectiveAt: m.effectiveAt || null,
        status: m.status,
        createdAt: m.createdAt,
        consumedAt: m.consumedAt || null,
      })),
    }
  }

  // ---- streams ----

  async *streamEvents(
    sessionId: string,
    since = '',
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    // The signal lets the controller tear down a HALF-OPEN stream (a socket
    // that never errors but stops delivering) and reconnect from the anchor.
    const opts = signal ? { signal } : undefined
    for await (const e of this._c.watchSession(
      { id: sessionId, since },
      opts,
    )) {
      const params = (e.params ?? {}) as Record<string, unknown>
      const runId = params['run_id']
      yield makeStreamEvent(
        e.event,
        params,
        e.eid,
        typeof runId === 'string' ? runId : '',
      )
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

  async setToolConfigValue(
    extId: string,
    name: string,
    value: unknown,
  ): Promise<void> {
    await this._c.setExtensionConfig({
      extId,
      name,
      value: {
        kind: {
          case: 'stringValue',
          value: value == null ? '' : String(value),
        },
      },
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
    const r = await this._guard(() =>
      this._c.listPresets({ locale: locale ?? '' }),
    )
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
    const r = await this._guard(() =>
      this._c.listTools({ locale: locale ?? '' }),
    )
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

export type { ToolState }
export { modelRefOf }

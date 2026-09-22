// ModelsDev — the web port of flutter services/models_dev.dart: the
// models.opencode.ai catalog with a 1h TTL cache (CacheStorage).
export interface MdModel {
  id: string
  name: string
  description?: string
  contextLimit?: number
  reasoning?: boolean
  toolCall?: boolean
  attachment?: boolean
}

export interface MdProvider {
  npm: string
  name: string
  description?: string
  type?: string
  models: MdModel[]
}

const URL_ = 'https://models.opencode.ai/api.json'
const CACHE_KEY = 'abcp-models-dev'
const TTL = 60 * 60 * 1000

interface CacheShape {
  at: number
  providers: MdProvider[]
}

let memory: CacheShape | null = null

async function readCache(): Promise<CacheShape | null> {
  if (memory && Date.now() - memory.at < TTL) return memory
  if (!('caches' in window)) return null
  try {
    const cache = await caches.open(CACHE_KEY)
    const res = await cache.match(CACHE_KEY)
    if (!res) return null
    const data = (await res.json()) as CacheShape
    if (Date.now() - data.at >= TTL) return null
    memory = data
    return data
  } catch {
    return null
  }
}

async function writeCache(providers: MdProvider[]) {
  const data: CacheShape = { at: Date.now(), providers }
  memory = data
  if (!('caches' in window)) return
  try {
    const cache = await caches.open(CACHE_KEY)
    await cache.put(CACHE_KEY, new Response(JSON.stringify(data)))
  } catch {
    /* cache unavailable */
  }
}

export async function loadModelsDev(
  forceRefresh = false,
): Promise<MdProvider[]> {
  if (!forceRefresh) {
    const cached = await readCache()
    if (cached) return cached.providers
  }
  const res = await fetch(URL_)
  if (!res.ok) throw new Error(`models.dev ${res.status}`)
  const json = (await res.json()) as Record<
    string,
    {
      name?: string
      description?: string
      type?: string
      models?: Record<string, Record<string, unknown>>
    }
  >
  const lim = (m: Record<string, unknown>): number | undefined => {
    const l = m['limit']
    if (l && typeof l === 'object') {
      const ctx = (l as Record<string, unknown>)['context']
      const n = Number(ctx)
      if (n > 0) return n
    }
    return undefined
  }
  const providers: MdProvider[] = []
  for (const [npm, p] of Object.entries(json)) {
    const models: MdModel[] = []
    for (const [id, m] of Object.entries(p.models ?? {})) {
      models.push({
        id,
        name: (m['name'] as string) || id,
        description: m['description'] as string | undefined,
        contextLimit: lim(m),
        reasoning: !!m['reasoning'],
        toolCall: !!m['tool_call'],
        attachment: !!m['attachment'],
      })
    }
    providers.push({
      npm,
      name: p.name || npm,
      description: p.description,
      type: p.type,
      models,
    })
  }
  await writeCache(providers)
  return providers
}

/** Map a models.dev npm package to the provider api_type (npmToType). */
export function npmToType(npm: string): string {
  const t = npm.split('/').pop() ?? npm
  switch (t) {
    case 'anthropic':
      return 'anthropic'
    case 'google':
      return 'gemini'
    case 'groq':
    case 'openai':
    case 'xai':
    case 'deepseek':
    case 'mistral':
    case 'openrouter':
    case 'together':
    case 'fireworks':
    case 'llamacpp':
    case 'ollama':
    case 'lmstudio':
    case 'vllm':
    case 'zai':
    case 'moonshot':
    case 'qwen':
      return 'openai-compatible'
    default:
      return 'openai-compatible'
  }
}

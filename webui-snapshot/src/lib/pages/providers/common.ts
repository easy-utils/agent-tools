// Shared provider helpers — port of the providers.dart top-level constants.
/** The 8 first-class modalities, in section order. */
export const MODEL_CAPABILITIES = [
  'text',
  'image',
  'video',
  'speech',
  'transcription',
  'embedding',
  'rerank',
  'realtime',
] as const

/** The api types that can serve a modality (from the server catalog). */
export function apiTypesForCapability(
  catalog: Record<string, string[]>,
  capability: string,
): string[] {
  const out = Object.entries(catalog)
    .filter(([, caps]) => caps.includes(capability))
    .map(([t]) => t)
    .sort()
  return out.length ? out : ['openai-compatible']
}

/** Localized capability label key. */
export function capabilityLabelKey(capability: string): string {
  switch (capability) {
    case 'image':
      return 'capImage'
    case 'video':
      return 'capVideo'
    case 'speech':
      return 'capSpeech'
    case 'transcription':
      return 'capTranscription'
    case 'embedding':
      return 'capEmbedding'
    case 'rerank':
    case 'reranking':
      return 'capReranking'
    case 'realtime':
      return 'capRealtime'
    default:
      return 'capText'
  }
}

export function apiTypeLabelKey(apiType: string): string {
  switch (apiType) {
    case 'openai-compatible':
      return 'apiTypeOpenaiCompat'
    case 'openai':
      return 'apiTypeOpenai'
    case 'anthropic':
      return 'apiTypeAnthropic'
    case 'gemini':
    case 'google':
      return 'apiTypeGemini'
    case 'deepseek':
      return 'apiTypeDeepseek'
    case 'cohere':
      return 'apiTypeCohere'
    case 'vercel-compatible-gateway':
      return 'apiTypeGateway'
    default:
      return ''
  }
}

// Media runtime — the web port of flutter media_cache + download_service: a
// bounded (LRU) per-code blob-URL cache for inline rendering, progressive
// streaming into object URLs, and save-as download.
//
// The PURE classification/formatting helpers (mime kinds, preview renderer
// choice, icon slots, ThumbHash placeholders, byte/duration formatting) live
// in file-types.ts and are re-exported here so existing imports keep working.
import type { AgentApi } from './api'
import { t } from './i18n.svelte'
import { showErrorToast } from './toast.svelte'

export * from './file-types'

/** Cap on cached object URLs. Each entry can be tens of MB (video), so the
 *  cache is deliberately small and evicts the least-recently-used entry,
 *  revoking its object URL to release the blob. */
const URL_CACHE_CAP = 48

const urlCache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()

function touch(code: string, url: string): void {
  // Re-insert to mark most-recently-used.
  urlCache.delete(code)
  urlCache.set(code, url)
  while (urlCache.size > URL_CACHE_CAP) {
    const oldest = urlCache.keys().next().value
    if (oldest === undefined) break
    const old = urlCache.get(oldest)
    if (old) URL.revokeObjectURL(old)
    urlCache.delete(oldest)
  }
}

/** Object URL for a file code (cached); '' when the fetch fails. */
export function mediaUrl(api: AgentApi, code: string): Promise<string> {
  const hit = urlCache.get(code)
  if (hit) {
    touch(code, hit)
    return Promise.resolve(hit)
  }
  const pending = inflight.get(code)
  if (pending) return pending
  const p = api
    .fetchFileBlob(code)
    .then(blob => {
      const url = URL.createObjectURL(blob)
      touch(code, url)
      return url
    })
    .catch(() => '')
    .finally(() => inflight.delete(code))
  inflight.set(code, p)
  return p
}

/**
 * Stream a file into an object URL (progressive), reporting progress. Used for
 * video/audio/large images so rendering can begin before the whole object has
 * arrived (GetFileStream). Falls back to [mediaUrl] semantics on failure.
 */
export async function mediaStreamUrl(
  api: AgentApi,
  code: string,
  mime: string,
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  const hit = urlCache.get(code)
  if (hit) {
    touch(code, hit)
    return hit
  }
  try {
    const blob = await api.streamFileBlob(code, mime, onProgress)
    const url = URL.createObjectURL(blob)
    touch(code, url)
    return url
  } catch {
    return ''
  }
}

export function dropMediaUrl(code: string) {
  const url = urlCache.get(code)
  if (url) {
    URL.revokeObjectURL(url)
    urlCache.delete(code)
  }
  inflight.delete(code)
}

/**
 * Save-as download of a file code (download_service_web.dart).
 *
 * Streams the bytes (GetFileStream) instead of the unary GetFile: the whole
 * file never has to fit one RPC message, progress can be reported, and the
 * blob is built once (a unary response is buffered by the transport AND again
 * by the Blob). Falls back to the unary fetch when the server build has no
 * streaming method, so an older agent still downloads correctly.
 *
 * Returns a result instead of throwing: every caller is a fire-and-forget UI
 * action, and the previous implementation's silent rejection is exactly why a
 * failed click looked like "nothing happens".
 */
export async function downloadFile(
  api: AgentApi,
  code: string,
  name: string,
  opts: {
    mime?: string | null
    onProgress?: (done: number, total: number) => void
  } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  let blob: Blob
  try {
    try {
      blob = await api.streamFileBlob(code, opts.mime ?? '', opts.onProgress)
    } catch {
      // Streaming unavailable (e.g. a server without GetFileStream).
      blob = await api.fetchFileBlob(code)
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  try {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name || code
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  return { ok: true }
}

/**
 * Download with user-visible feedback: for use directly from a click handler.
 * Shows a toast on failure (the card previously swallowed errors, so a failed
 * click was indistinguishable from a no-op) and returns whether it succeeded.
 */
export async function downloadWithFeedback(
  api: AgentApi,
  code: string,
  name: string,
  opts: {
    mime?: string | null
    onProgress?: (done: number, total: number) => void
  } = {},
): Promise<boolean> {
  const r = await downloadFile(api, code, name, opts)
  if (!r.ok) showErrorToast(`${t('downloadFailed')}: ${r.error}`)
  return r.ok
}

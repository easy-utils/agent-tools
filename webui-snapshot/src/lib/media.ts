// Media helpers — the web port of flutter media_cache + download_service:
// a bounded (LRU) per-code blob-URL cache for inline rendering + a save-as
// download. Also hosts the metadata-first helpers: a stable aspect-ratio box
// from server-derived dimensions, a base64 ThumbHash placeholder, and the
// thumbnail (a separate small file) loader.
import { thumbHashToDataURL } from 'thumbhash'
import type { AgentApi } from './api'

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

/** Save-as download of a file code (download_service_web.dart). */
export async function downloadFile(api: AgentApi, code: string, name: string) {
  const blob = await api.fetchFileBlob(code)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name || code
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function mimeToKind(
  mime?: string | null,
): 'image' | 'audio' | 'video' | 'pdf' | 'office' | 'text' | 'file' {
  if (!mime) return 'file'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (mime === 'application/pdf') return 'pdf'
  if (OFFICE_MIMES.has(mime)) return 'office'
  if (isTextMime(mime)) return 'text'
  return 'file'
}

/** OOXML office types the viewer can render (docx/xlsx/pptx). */
export const MIME_DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const MIME_PPTX =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
export const OFFICE_MIMES = new Set([MIME_DOCX, MIME_XLSX, MIME_PPTX])

export type PreviewKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'markdown'
  | 'code'
  | 'json'
  | 'csv'
  | 'html'
  | 'text'
  | 'none'

const CODE_EXT = new Set([
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'kt',
  'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'rb', 'php', 'sh', 'bash',
  'zsh', 'fish', 'sql', 'css', 'scss', 'less', 'vue', 'svelte', 'lua', 'pl',
  'r', 'dart', 'scala', 'clj', 'ex', 'exs', 'erl', 'hs', 'ml', 'toml', 'ini',
  'conf', 'env', 'dockerfile', 'makefile', 'gradle', 'tf', 'proto',
])

/** Resolve the most specific preview renderer for a (mime, name) pair. */
export function previewKind(mime?: string | null, name?: string): PreviewKind {
  const m = (mime ?? '').toLowerCase()
  const ext = (name ?? '').split('.').pop()?.toLowerCase() ?? ''
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (m === MIME_DOCX || ext === 'docx') return 'docx'
  if (m === MIME_XLSX || ext === 'xlsx') return 'xlsx'
  if (m === MIME_PPTX || ext === 'pptx') return 'pptx'
  if (m === 'text/markdown' || ext === 'md' || ext === 'markdown') return 'markdown'
  if (m === 'application/json' || ext === 'json') return 'json'
  if (m === 'text/csv' || m === 'text/tab-separated-values' || ext === 'csv' || ext === 'tsv')
    return 'csv'
  if (m === 'text/html' || ext === 'html' || ext === 'htm') return 'html'
  if (CODE_EXT.has(ext)) return 'code'
  if (isTextMime(m) || m.startsWith('text/')) return 'text'
  return 'none'
}

/** Pick a file-type icon slot for a (mime, name) pair. */
export function fileIconSlot(
  mime?: string | null,
  name?: string,
): 'file_pdf' | 'file_doc' | 'file_sheet' | 'file_slides' | 'file_archive' | 'file_json' | 'file_image' | 'file_video' | 'file_audio' | 'file_code' | 'file' {
  const k = previewKind(mime, name)
  switch (k) {
    case 'pdf':
      return 'file_pdf'
    case 'docx':
      return 'file_doc'
    case 'xlsx':
      return 'file_sheet'
    case 'pptx':
      return 'file_slides'
    case 'image':
      return 'file_image'
    case 'video':
      return 'file_video'
    case 'audio':
      return 'file_audio'
    case 'json':
      return 'file_json'
    case 'code':
    case 'markdown':
    case 'html':
      return 'file_code'
    case 'csv':
      return 'file_sheet'
    case 'text':
      return 'file'
    default: {
      const ext = (name ?? '').split('.').pop()?.toLowerCase() ?? ''
      if (ext === 'zip' || ext === 'tar' || ext === 'gz' || ext === '7z' || ext === 'rar')
        return 'file_archive'
      return 'file'
    }
  }
}

/** Text-like mimes (markdown / code / json / csv / html / plain) the viewer
 *  can render in a monospace or rendered pane. */
export function isTextMime(mime: string): boolean {
  if (mime.startsWith('text/')) return true
  return (
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/x-yaml' ||
    mime === 'application/yaml' ||
    mime === 'application/toml' ||
    mime === 'application/javascript' ||
    mime === 'application/typescript' ||
    mime === 'application/x-sh'
  )
}

/** True when the viewer has a dedicated renderer for the file. */
export function isPreviewable(mime?: string | null, name?: string): boolean {
  const k = mimeToKind(mime)
  if (k !== 'file') return k === 'image' || k === 'video' || k === 'audio' || k === 'pdf' || k === 'office' || k === 'text'
  return name ? isTextMime(guessMime(name)) : false
}

/** Decode a base64 ThumbHash into a blurred placeholder data URL ('' when
 *  empty/invalid). Rendered behind an image while the real blob loads. */
export function thumbhashPlaceholder(hash?: string | null): string {
  if (!hash) return ''
  try {
    const bytes = Uint8Array.from(atob(hash), c => c.charCodeAt(0))
    return thumbHashToDataURL(bytes)
  } catch {
    return ''
  }
}

/** A stable CSS `aspect-ratio` value from server dimensions, or '' when
 *  unknown. Applied while loading to reserve the final box and prevent the
 *  layout from jumping once the image binds. */
export function aspectRatio(
  width?: number | null,
  height?: number | null,
): string {
  if (!width || !height || width <= 0 || height <= 0) return ''
  return `${width} / ${height}`
}

export function formatDuration(ms?: number | null): string {
  if (!ms || ms <= 0) return ''
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

export function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const table: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    heic: 'image/heic',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    webm: 'video/webm',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webmv: 'video/webm',
    pdf: 'application/pdf',
    txt: 'text/plain',
    log: 'text/plain',
    md: 'text/markdown',
    markdown: 'text/markdown',
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    json: 'application/json',
    yaml: 'application/x-yaml',
    yml: 'application/x-yaml',
    xml: 'application/xml',
    toml: 'application/toml',
    html: 'text/html',
    htm: 'text/html',
    zip: 'application/zip',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }
  return table[ext] || 'application/octet-stream'
}

export function formatBytes(size?: number | null): string {
  if (!size || size <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = size
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

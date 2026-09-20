// Global full-screen file viewer overlay — the IM-aligned lightbox. Any file
// card opens the viewer with the full ordered list of files in its message, so
// the viewer can navigate (←/→) between siblings. Kept global (like overlays)
// so it renders once at the app root and survives card unmounts.
import type { FileRef } from './models'

export interface ViewerState {
  files: FileRef[]
  index: number
}

export const viewer = $state<{ state: ViewerState | null }>({ state: null })

/** Open the viewer on `file` within `files` (the whole message's file list). */
export function openViewer(file: FileRef, files: FileRef[] = [file]): void {
  const list = files.length > 0 ? files : [file]
  let index = list.findIndex(f => f.code === file.code)
  if (index < 0) index = 0
  viewer.state = { files: list, index }
}

export function closeViewer(): void {
  viewer.state = null
}

export function viewerNext(): void {
  const s = viewer.state
  if (!s || s.files.length === 0) return
  s.index = (s.index + 1) % s.files.length
}

export function viewerPrev(): void {
  const s = viewer.state
  if (!s || s.files.length === 0) return
  s.index = (s.index - 1 + s.files.length) % s.files.length
}

export function viewerCurrent(): FileRef | null {
  const s = viewer.state
  if (!s) return null
  return s.files[s.index] ?? null
}

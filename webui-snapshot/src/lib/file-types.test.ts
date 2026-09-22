// Pure file-type helper unit tests — mime classification, preview/icon
// resolution and the human-readable formatters.
import { describe, expect, it } from 'vitest'
import {
  aspectRatio,
  fileIconSlot,
  formatBytes,
  formatDuration,
  guessMime,
  isPreviewable,
  isTextMime,
  mimeToKind,
  previewKind,
} from './file-types'

describe('mimeToKind', () => {
  it('classifies by top-level mime type', () => {
    expect(mimeToKind('image/png')).toBe('image')
    expect(mimeToKind('audio/mpeg')).toBe('audio')
    expect(mimeToKind('video/mp4')).toBe('video')
    expect(mimeToKind('application/pdf')).toBe('pdf')
    expect(mimeToKind('text/plain')).toBe('text')
    expect(mimeToKind('application/zip')).toBe('file')
  })

  it('classifies OOXML office types', () => {
    expect(
      mimeToKind(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('office')
  })

  it('treats missing mime as a generic file', () => {
    expect(mimeToKind(undefined)).toBe('file')
    expect(mimeToKind('')).toBe('file')
  })
})

describe('isTextMime', () => {
  it('accepts text/* and known application text types', () => {
    expect(isTextMime('text/markdown')).toBe(true)
    expect(isTextMime('application/json')).toBe(true)
    expect(isTextMime('application/x-yaml')).toBe(true)
  })

  it('rejects binary types', () => {
    expect(isTextMime('image/png')).toBe(false)
    expect(isTextMime('application/zip')).toBe(false)
  })
})

describe('guessMime', () => {
  it('maps common extensions', () => {
    expect(guessMime('a.png')).toBe('image/png')
    expect(guessMime('a.MP4')).toBe('video/mp4')
    expect(guessMime('doc.md')).toBe('text/markdown')
  })

  it('falls back to octet-stream', () => {
    expect(guessMime('weird.xyz')).toBe('application/octet-stream')
    expect(guessMime('noext')).toBe('application/octet-stream')
  })
})

describe('previewKind', () => {
  it('prefers mime, falls back to extension', () => {
    expect(previewKind('image/png')).toBe('image')
    expect(previewKind(null, 'notes.md')).toBe('markdown')
    expect(previewKind('', 'main.go')).toBe('code')
    expect(previewKind('', 'data.json')).toBe('json')
    expect(previewKind('', 'sheet.csv')).toBe('csv')
    expect(previewKind(undefined, 'index.html')).toBe('html')
  })

  it('returns none for unknown', () => {
    expect(previewKind('application/zip', 'a.bin')).toBe('none')
  })
})

describe('fileIconSlot', () => {
  it('maps preview kinds to icon slots', () => {
    expect(fileIconSlot('application/pdf')).toBe('file_pdf')
    expect(fileIconSlot('', 'a.docx')).toBe('file_doc')
    expect(fileIconSlot('', 'a.xlsx')).toBe('file_sheet')
    expect(fileIconSlot('', 'a.pptx')).toBe('file_slides')
    expect(fileIconSlot('image/png')).toBe('file_image')
    expect(fileIconSlot('', 'main.ts')).toBe('file_code')
  })

  it('detects archives by extension', () => {
    expect(fileIconSlot('', 'bundle.zip')).toBe('file_archive')
    expect(fileIconSlot('', 'bundle.tar')).toBe('file_archive')
  })

  it('falls back to a generic file icon', () => {
    expect(fileIconSlot('application/octet-stream', 'blob')).toBe('file')
  })
})

describe('isPreviewable', () => {
  it('true for a dedicated renderer', () => {
    expect(isPreviewable('image/png')).toBe(true)
    expect(isPreviewable('application/pdf')).toBe(true)
  })

  it('falls back to the extension for text-like names', () => {
    expect(isPreviewable('application/octet-stream', 'README.md')).toBe(true)
    expect(isPreviewable('application/octet-stream', 'a.bin')).toBe(false)
  })
})

describe('formatters', () => {
  it('aspectRatio only with positive dimensions', () => {
    expect(aspectRatio(16, 9)).toBe('16 / 9')
    expect(aspectRatio(0, 9)).toBe('')
    expect(aspectRatio(16, null)).toBe('')
  })

  it('formatDuration scales to hours', () => {
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(3_661_000)).toBe('1:01:01')
    expect(formatDuration(0)).toBe('')
    expect(formatDuration(null)).toBe('')
  })

  it('formatBytes uses binary units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(0)).toBe('')
  })
})

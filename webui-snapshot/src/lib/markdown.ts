// Markdown rendering — the web counterpart of flutter_markdown_plus +
// re_highlight: marked with fenced-code highlight.js + DOMPurify sanitize.

import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import { marked } from 'marked'

marked.setOptions({
  gfm: true,
  breaks: true,
})

// Model-authored links may carry target="_blank" (the sanitize allowlist
// permits the attribute). Any such link must not get a window handle back:
// force rel=noopener noreferrer on EVERY target=_blank anchor. Registered
// ONCE at module scope — DOMPurify hooks accumulate globally, so a per-call
// addHook would stack duplicate handlers.
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node instanceof Element && node.getAttribute('target') === '_blank') {
    const prev = node.getAttribute('rel')
    const parts = new Set((prev ?? '').split(/\s+/).filter(Boolean))
    parts.add('noopener')
    parts.add('noreferrer')
    node.setAttribute('rel', [...parts].join(' '))
  }
})

export function renderMarkdown(src: string): string {
  const raw = marked.parse(src ?? '', { async: false }) as string
  const clean = DOMPurify.sanitize(raw, {
    ADD_ATTR: ['target'],
  })
  return highlightCodeBlocks(clean)
}

function highlightCodeBlocks(html: string): string {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  for (const pre of tpl.content.querySelectorAll('pre code')) {
    const el = pre as HTMLElement
    if (!el.className.includes('language-')) continue
    const lang = el.className.replace(/.*language-([\w+#-]+).*/, '$1')
    try {
      if (lang && hljs.getLanguage(lang)) {
        el.innerHTML = hljs.highlight(el.textContent ?? '', {
          language: lang,
        }).value
      } else {
        el.innerHTML = hljs.highlightAuto(el.textContent ?? '').value
      }
    } catch {
      /* leave as-is */
    }
  }
  return tpl.innerHTML
}

// Markdown rendering — the web counterpart of flutter_markdown_plus +
// re_highlight: marked with fenced-code highlight.js + DOMPurify sanitize.
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'

marked.setOptions({
  gfm: true,
  breaks: true,
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
        el.innerHTML = hljs.highlight(el.textContent ?? '', { language: lang }).value
      } else {
        el.innerHTML = hljs.highlightAuto(el.textContent ?? '').value
      }
    } catch {
      /* leave as-is */
    }
  }
  return tpl.innerHTML
}

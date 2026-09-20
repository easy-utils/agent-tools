<script lang="ts">
  // CodeView — plain / code / json text with highlight.js, lazily imported.
  // Used for text, code, json and generic text-like subtypes.
  import { onMount } from 'svelte'
  import { t } from '$lib/i18n.svelte'
  import type { PreviewKind } from '$lib/media'

  let {
    src,
    kind,
    name,
  }: { src: string; kind: PreviewKind; name: string } = $props()

  let text = $state('')
  let html = $state('')
  let loading = $state(true)
  let error = $state(false)

  function ext(): string {
    return name.split('.').pop()?.toLowerCase() ?? ''
  }

  onMount(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(src)
        let raw = await res.text()
        if (cancelled) return
        if (kind === 'json' || ext() === 'json') {
          try {
            raw = JSON.stringify(JSON.parse(raw), null, 2)
          } catch {
            /* leave as-is */
          }
        }
        text = raw
        loading = false
        if (kind === 'code' || kind === 'json' || !kind) {
          try {
            const hljs = (await import('highlight.js')).default
            const lang = hljs.getLanguage(ext()) ? ext() : ''
            html = lang
              ? hljs.highlight(raw, { language: lang }).value
              : hljs.highlightAuto(raw).value
          } catch {
            html = ''
          }
        }
      } catch {
        error = true
        loading = false
      }
    })()
    return () => {
      cancelled = true
    }
  })
</script>

<div class="max-h-[80vh] w-[min(92vw,900px)] overflow-auto rounded-md bg-white/5">
  {#if loading}
    <div class="p-6 text-center text-meta text-white/60">{t('loading')}</div>
  {:else if error}
    <div class="p-6 text-center text-meta text-white/60">{t('fileUnsupported')}</div>
  {:else if html}
    <pre class="p-3 font-mono text-[12px] leading-relaxed text-white/90"><code>{@html html}</code></pre>
  {:else}
    <pre class="p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-white/90">{text}</pre>
  {/if}
</div>

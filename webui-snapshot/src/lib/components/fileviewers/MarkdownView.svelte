<script lang="ts">
  // MarkdownView — fetch the markdown source and render with the app's own
  // renderMarkdown (marked + highlight.js + DOMPurify), so it matches chat.
  import { onMount } from 'svelte'
  import { renderMarkdown } from '$lib/markdown'
  import { t } from '$lib/i18n.svelte'

  let { src }: { src: string } = $props()

  let html = $state('')
  let loading = $state(true)

  onMount(() => {
    void (async () => {
      try {
        const raw = await (await fetch(src)).text()
        html = renderMarkdown(raw)
      } finally {
        loading = false
      }
    })()
  })
</script>

<div class="max-h-[80vh] w-[min(92vw,860px)] overflow-auto rounded-md bg-white/5 p-4">
  {#if loading}
    <div class="text-meta text-white/60">{t('loading')}</div>
  {:else}
    <div class="md-body prose-invert text-white/90">{@html html}</div>
  {/if}
</div>

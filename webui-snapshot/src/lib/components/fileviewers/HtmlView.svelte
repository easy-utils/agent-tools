<script lang="ts">
  // HtmlView — render an HTML file inside a SANDBOXED iframe. The iframe has
  // no `allow-scripts`/`allow-same-origin`, so any script in the file cannot
  // run and cannot reach the app's origin (defence in depth beyond DOMPurify,
  // which is unnecessary here because the document cannot execute).
  import { onMount } from 'svelte'
  import { t } from '$lib/i18n.svelte'

  let { src }: { src: string } = $props()

  let html = $state('')
  let loading = $state(true)

  onMount(() => {
    void (async () => {
      try {
        html = await (await fetch(src)).text()
      } finally {
        loading = false
      }
    })()
  })
</script>

<div class="h-[80vh] w-[min(92vw,900px)] overflow-hidden rounded-md bg-white">
  {#if loading}
    <div class="p-6 text-center text-meta text-muted-foreground">{t('loading')}</div>
  {:else}
    <iframe
      title="html preview"
      sandbox=""
      srcdoc={html}
      class="size-full border-0 bg-white"
    ></iframe>
  {/if}
</div>

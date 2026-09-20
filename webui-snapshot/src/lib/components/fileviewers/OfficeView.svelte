<script lang="ts">
  // OfficeView — docx / xlsx / pptx renderers, all lazily imported. Only
  // modern OOXML is supported (legacy .doc/.xls/.ppt are not).
  import { onMount } from 'svelte'
  import { t } from '$lib/i18n.svelte'
  import { AppIcons } from '$lib/icons'
  import type { PreviewKind } from '$lib/media'

  let {
    src,
    kind,
    name,
  }: { src: string; kind: PreviewKind; name: string } = $props()

  let host: HTMLDivElement | null = $state(null)
  let loading = $state(true)
  let error = $state(false)

  onMount(() => {
    let cancelled = false
    let dispose: (() => void) | null = null
    void (async () => {
      try {
        const res = await fetch(src)
        const buf = await res.arrayBuffer()
        if (cancelled || host === null) return

        if (kind === 'docx') {
          const docx = await import('docx-preview')
          await docx.renderAsync(buf, host, undefined, {
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            breakPages: true,
            experimental: true,
          })
        } else if (kind === 'xlsx') {
          const XLSX = await import('xlsx')
          const wb = XLSX.read(buf, { type: 'array' })
          const first = wb.SheetNames[0]
          if (first === undefined) throw new Error('empty workbook')
          const sheet = wb.Sheets[first]
          const table = XLSX.utils.sheet_to_html(sheet ?? {}, {
            editable: false,
          })
          const wrapper = document.createElement('div')
          wrapper.className = 'xlsx-host'
          wrapper.innerHTML = table
          host.append(wrapper)
        } else {
          const mod = await import('pptx-preview')
          const previewer = mod.init(host, {
            width: Math.min(960, host.clientWidth || 800),
            height: Math.round(Math.min(960, host.clientWidth || 800) * 0.5625),
            mode: 'slide',
          })
          await previewer.preview(buf)
          dispose = () => previewer.destroy()
        }
        loading = false
      } catch {
        error = true
        loading = false
      }
    })()
    return () => {
      cancelled = true
      dispose?.()
    }
  })
</script>

<div class="max-h-[82vh] w-[min(94vw,1000px)] overflow-auto rounded-md bg-white p-3 text-black">
  {#if loading}
    <div class="flex flex-col items-center gap-2 p-6 text-meta text-muted-foreground">
      <span class="size-7 animate-spin rounded-full border-2 border-black/10 border-t-black/50"></span>
      <span>{t('loading')}</span>
    </div>
  {/if}
  {#if error}
    <div class="flex items-center justify-center gap-2 p-6 text-meta text-muted-foreground">
      <AppIcons.error class="size-4" /> {t('fileUnsupported')} — {name}
    </div>
  {/if}
  <div bind:this={host} class="office-host"></div>
</div>

<style>
  :global(.office-host .xlsx-host table) {
    border-collapse: collapse;
    font-size: 12px;
  }
  :global(.office-host .xlsx-host td),
  :global(.office-host .xlsx-host th) {
    border: 1px solid #d4d4d8;
    padding: 2px 6px;
  }
</style>

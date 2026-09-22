<script lang="ts">
  // FileViewer — the global full-screen lightbox (IM-aligned). Opened from any
  // file card; renders the current file with the appropriate renderer and
  // navigates (←/→) across the message's file list. Heavy renderers (pdfjs /
  // docx / xlsx / pptx) are dynamically imported so they never weigh on the
  // first paint.
  import { onMount } from 'svelte'
  import type { AgentApi } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import {
    downloadWithFeedback,
    formatBytes,
    formatDuration,
    mediaStreamUrl,
    mediaUrl,
    previewKind,
    thumbhashPlaceholder,
    type PreviewKind,
  } from '$lib/media'
  import {
    closeViewer,
    viewer,
    viewerNext,
    viewerPrev,
  } from '$lib/fileviewer.svelte'
  import { AppIcons } from '$lib/icons'
  import { cn } from '$lib/utils'

  let { api }: { api: AgentApi } = $props()

  const current = $derived(viewer.state?.files[viewer.state.index] ?? null)
  const kind = $derived<PreviewKind>(
    current ? previewKind(current.mime, current.name ?? undefined) : 'none',
  )

  let url = $state('')
  let loading = $state(false)
  let progress = $state(0)
  let thumbUrl = $state('')
  let zoom = $state(1)
  let panX = $state(0)
  let panY = $state(0)
  let dragging = $state(false)
  let dragStart = { x: 0, y: 0, px: 0, py: 0 }

  const placeholder = $derived(thumbhashPlaceholder(current?.thumbhash))

  // Load the current file whenever the selection changes. Images use the
  // plain (cached) fetch for correct decoding; media streams for progress.
  $effect(() => {
    const c = current
    if (!c) return
    url = ''
    zoom = 1
    panX = 0
    panY = 0
    // A local (not-yet-uploaded) attachment already has an object URL.
    if (c.localUrl) {
      url = c.localUrl
      loading = false
      return
    }
    loading = true
    progress = 0
    void (async () => {
      let u = ''
      if (kind === 'video' || kind === 'audio') {
        u = await mediaStreamUrl(api, c.code, c.mime ?? '', (d, total) => {
          progress = total > 0 ? Math.round((d / total) * 100) : 0
        })
      } else {
        u = await mediaUrl(api, c.code)
      }
      url = u
      loading = false
    })()
  })

  // Thumbnail (separate small file) as an instant blurred stand-in.
  $effect(() => {
    const tc = current?.thumbCode
    thumbUrl = ''
    if (tc) {
      void mediaUrl(api, tc).then(u => (thumbUrl = u))
    }
  })

  function onKey(e: KeyboardEvent) {
    if (!viewer.state) return
    if (e.key === 'Escape') closeViewer()
    else if (e.key === 'ArrowRight') viewerNext()
    else if (e.key === 'ArrowLeft') viewerPrev()
    else if (e.key === '+' || e.key === '=') zoom = Math.min(8, zoom * 1.25)
    else if (e.key === '-') zoom = Math.max(0.25, zoom / 1.25)
    else if (e.key === '0') {
      zoom = 1
      panX = 0
      panY = 0
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function startDrag(e: PointerEvent) {
    if (kind !== 'image' || zoom <= 1) return
    dragging = true
    dragStart = { x: e.clientX, y: e.clientY, px: panX, py: panY }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  function onDrag(e: PointerEvent) {
    if (!dragging) return
    panX = dragStart.px + (e.clientX - dragStart.x)
    panY = dragStart.py + (e.clientY - dragStart.y)
  }
  function endDrag() {
    dragging = false
  }
  function wheel(e: WheelEvent) {
    if (kind !== 'image') return
    e.preventDefault()
    zoom = Math.min(8, Math.max(0.25, zoom * (e.deltaY < 0 ? 1.1 : 0.9)))
  }
</script>

{#if viewer.state && current}
  <div
    class="fixed inset-0 z-[95] flex flex-col bg-black/90 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
  >
    <!-- top bar -->
    <div class="flex items-center gap-1.5 px-3 py-2 text-white/85">
      <AppIcons.file class="size-4 shrink-0 opacity-70" />
      <span class="min-w-0 flex-1 truncate text-meta">{current.name || current.code}</span>
      {#if current.size}
        <span class="hidden text-micro opacity-60 sm:inline">{formatBytes(current.size)}</span>
      {/if}
      {#if current.durationMs}
        <span class="hidden text-micro opacity-60 sm:inline">{formatDuration(current.durationMs)}</span>
      {/if}
      <button type="button" class="rounded p-1.5 hover:bg-white/10" title={t('download')} aria-label={t('download')} onclick={() => void downloadWithFeedback(api, current.code, current.name ?? current.code, { mime: current.mime })}>
        <AppIcons.download class="size-4" />
      </button>
      <button type="button" class="rounded p-1.5 hover:bg-white/10" title={t('close')} aria-label={t('close')} onclick={closeViewer}>
        <AppIcons.close class="size-4" />
      </button>
    </div>

    <!-- stage -->
    <div class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
      {#if viewer.state.files.length > 1}
        <button
          type="button"
          class="absolute left-2 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          title={t('back')}
          aria-label={t('back')}
          onclick={viewerPrev}
        >
          <AppIcons.chevron_left class="size-5" />
        </button>
        <button
          type="button"
          class="absolute right-2 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          title="Next"
          aria-label="Next"
          onclick={viewerNext}
        >
          <AppIcons.chevron_right class="size-5" />
        </button>
      {/if}

      {#if loading && kind !== 'image'}
        <div class="flex flex-col items-center gap-3 text-white/70">
          <span class="size-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80"></span>
          <span class="text-meta">{t('loading')}{progress > 0 ? ` ${progress}%` : ''}</span>
        </div>
      {/if}

      {#if kind === 'image'}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="flex size-full items-center justify-center overflow-hidden"
          class:cursor-grab={zoom > 1}
          class:cursor-grabbing={dragging}
          onpointerdown={startDrag}
          onpointermove={onDrag}
          onpointerup={endDrag}
          onpointercancel={endDrag}
          onwheel={wheel}
        >
          {#if placeholder && !url}
            <img src={placeholder} alt="" class="max-h-full max-w-full scale-110 object-contain blur-xl" />
          {/if}
          {#if url}
            <img
              src={url}
              alt={current.name ?? current.code}
              draggable="false"
              class="max-h-full max-w-full select-none rounded object-contain transition-transform"
              style="transform: translate({panX}px, {panY}px) scale({zoom})"
            />
          {/if}
        </div>
      {:else if kind === 'video'}
        {#if url}
          <video src={url} controls autoplay class="max-h-full max-w-full rounded"><track kind="captions" /></video>
        {/if}
      {:else if kind === 'audio'}
        {#if url}
          <audio src={url} controls autoplay class="w-80"></audio>
        {/if}
      {:else if url}
        {#await import('./fileviewers/ViewerBody.svelte') then { default: ViewerBody }}
          <ViewerBody {api} file={current} kind={kind} src={url} />
        {/await}
      {/if}
    </div>

    <!-- zoom controls (image) -->
    {#if kind === 'image' && url}
      <div class="absolute right-3 bottom-3 flex items-center gap-1 rounded-full bg-white/10 p-1 text-white">
        <button type="button" class="rounded-full p-1.5 hover:bg-white/20" title={t('zoomOut')} aria-label={t('zoomOut')} onclick={() => (zoom = Math.max(0.25, zoom / 1.25))}><AppIcons.zoom_out class="size-4" /></button>
        <span class="min-w-10 text-center text-micro tabular-nums">{Math.round(zoom * 100)}%</span>
        <button type="button" class="rounded-full p-1.5 hover:bg-white/20" title={t('zoomIn')} aria-label={t('zoomIn')} onclick={() => (zoom = Math.min(8, zoom * 1.25))}><AppIcons.zoom_in class="size-4" /></button>
        <button type="button" class="rounded-full p-1.5 hover:bg-white/20" title={t('zoomReset')} aria-label={t('zoomReset')} onclick={() => { zoom = 1; panX = 0; panY = 0 }}><AppIcons.reset class="size-4" /></button>
      </div>
    {/if}
  </div>
{/if}

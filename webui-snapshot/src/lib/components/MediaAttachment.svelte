<script lang="ts">
  // MediaAttachment — web port of flutter widgets/media_attachment.dart:
  // inline attachment rendering (image / video / audio player / file chip) +
  // a full-screen viewer. Metadata-first: the box is reserved from the
  // server-derived width/height, a ThumbHash paints a blur placeholder, and
  // the (separate, small) thumbnail loads lazily in the viewport — the full
  // bytes are only fetched when the card actually needs them.
  import type { AgentApi } from '$lib/api'
  import type { FileRef } from '$lib/models'
  import { t } from '$lib/i18n.svelte'
  import {
    aspectRatio,
    downloadWithFeedback,
    fileIconSlot,
    formatBytes,
    formatDuration,
    mediaUrl,
    mimeToKind,
    previewKind,
    thumbhashPlaceholder,
  } from '$lib/media'
  import { openViewer } from '$lib/fileviewer.svelte'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'

  // Accept either the flat props (composer chips) or a `file` ref (chat).
  let {
    api,
    code,
    name = '',
    mime,
    size,
    file: fileProp = null,
    siblings = [],
    dimension,
    localUrl = '',
    onTap,
  }: {
    api: AgentApi
    code?: string
    name?: string
    mime?: string | null
    size?: number | null
    file?: FileRef | null
    /** Other file refs in the same message, so the viewer can navigate. */
    siblings?: FileRef[]
    /** Square tile size for composer chips (px); omit for inline bubbles. */
    dimension?: number
    /** Local preview (object URL) while uploading. */
    localUrl?: string
    onTap?: () => void
  } = $props()

  const ref = $derived<FileRef>(
    fileProp ?? { code: code ?? '', name, mime, size },
  )
  const viewRef = $derived<FileRef>(
    localUrl ? { ...ref, localUrl } : ref,
  )
  const codeVal = $derived(ref.code)
  // A not-yet-uploaded attachment has a synthetic `tmp-` code; never ask the
  // server for it (it would 500). Only server codes are fetchable.
  const serverCode = $derived(
    codeVal && !codeVal.startsWith('tmp-') ? codeVal : '',
  )
  const nameVal = $derived(ref.name || name || ref.code)
  const mimeVal = $derived(ref.mime ?? mime ?? null)

  // Media facts may be missing on a tool `data.files` entry (captured before
  // the agent's async probe finished) — resolve them once, on demand.
  let fetchedMeta = $state<{
    width?: number | null
    height?: number | null
    durationMs?: number | null
    thumbCode?: string | null
    thumbhash?: string | null
  } | null>(null)
  const meta = $derived({
    width: ref.width ?? fetchedMeta?.width ?? null,
    height: ref.height ?? fetchedMeta?.height ?? null,
    durationMs: ref.durationMs ?? fetchedMeta?.durationMs ?? null,
    thumbCode: ref.thumbCode ?? fetchedMeta?.thumbCode ?? null,
    thumbhash: ref.thumbhash ?? fetchedMeta?.thumbhash ?? null,
  })
  const needMeta = $derived(
    meta.width == null &&
      meta.thumbCode == null &&
      meta.thumbhash == null &&
      (mimeVal?.startsWith('image/') ||
        mimeVal?.startsWith('video/') ||
        mimeVal?.startsWith('audio/')),
  )

  let url = $state('')
  let thumbUrl = $state('')
  let imgError = $state(false)
  // Download state for the document/file chip: null = idle, 0..100 = streaming,
  // -1 = connecting (no total known yet). Drives the chip's spinner + percent.
  let dlPct = $state<number | null>(null)
  let visible = $state(false)
  let tile: HTMLElement | null = $state(null)

  const kind = $derived(mimeToKind(mimeVal))
  const pkind = $derived(previewKind(mimeVal, nameVal))
  const ratio = $derived(aspectRatio(meta.width, meta.height))
  const placeholder = $derived(thumbhashPlaceholder(meta.thumbhash))
  const canView = $derived(pkind !== 'none')

  // Only load a thumbnail while the card is (near) the viewport.
  $effect(() => {
    const el = tile
    if (!el || visible) return
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          visible = true
          io.disconnect()
        }
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => io.disconnect()
  })

  // Full media bytes: only for media kinds, and only once visible.
  $effect(() => {
    if (!visible || !serverCode) return
    if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return
    void mediaUrl(api, serverCode).then(u => {
      if (u) url = u
    })
  })

  // Resolve missing media facts once, when the card is visible and the ref
  // did not already carry them.
  $effect(() => {
    if (!visible || !serverCode || !needMeta || fetchedMeta !== null) return
    void api
      .fileHead(serverCode)
      .then(h => {
        fetchedMeta = {
          width: h.width,
          height: h.height,
          durationMs: h.durationMs,
          thumbCode: h.thumbCode,
          thumbhash: h.thumbhash,
        }
      })
      .catch(() => {
        fetchedMeta = {}
      })
  })

  // Thumbnail: a separate small file; cheap and viewport-gated.
  $effect(() => {
    const tc = meta.thumbCode
    if (!visible || !tc) return
    void mediaUrl(api, tc).then(u => {
      if (u) thumbUrl = u
    })
  })

  const shown = $derived(url || localUrl)
  const preview = $derived(shown || thumbUrl)

  function open() {
    onTap?.()
    if (canView && codeVal) {
      openViewer(viewRef, siblings.length > 0 ? siblings : [viewRef])
    } else if (serverCode && !canView) {
      // Documents / archives have no preview: a click is a save-as, matching
      // the bubble chip. (Previously the composer tile was simply disabled, so
      // clicking it did nothing at all.)
      void download()
    } else if (shown) {
      window.open(shown, '_blank')
    }
  }

  /** Stream the file to disk, showing progress in the chip. */
  async function download() {
    if (dlPct !== null)
      return // already running
    dlPct = -1
    await downloadWithFeedback(api, codeVal, nameVal, {
      mime: mimeVal,
      onProgress: (done, total) => {
        dlPct = total > 0 ? Math.round((done / total) * 100) : -1
      },
    })
    dlPct = null
  }

  /** Compact duration label for a video badge (m:ss / h:mm:ss). */
  const badgeDuration = formatDuration

  const iconSlot = $derived(fileIconSlot(mimeVal, nameVal))

  /** Decorative waveform bar heights (no audio analysis is available). Kept as
   *  a constant and iterated by INDEX: a duplicate value in an unkeyed {#each}
   *  over a number array collides on key and makes Svelte throw. */
  const WAVE_BARS = [6, 12, 18, 10, 15, 7, 13, 9, 16, 8, 14, 11] as const
  const WAVE_BARS_WIDE = [5, 9, 13, 7, 11, 15, 6, 12, 8, 14, 10, 16, 9, 13, 5, 11] as const

  /** Short type label for the document tile (extension, upper-cased). */
  const extLabel = $derived(
    (nameVal.split('.').pop() ?? '').toUpperCase().slice(0, 5) || 'FILE',
  )
</script>

{#snippet FileGlyph(cls: string)}
  {@const C = AppIcons[iconSlot]}
  <C class={cls} />
{/snippet}

{#if dimension}
  <!-- composer tile. ONE square slot per attachment, but the CONTENT is
       type-specific (image thumbnail / video first-frame + play / audio
       waveform + time / per-type document glyph + extension) so an attachment
       is identifiable before it is sent.

       bind:this matters: the shared lazy-loading effects (full media,
       server metadata, thumbnail) are gated on `visible`, which the
       IntersectionObserver only sets for an observed element — without the
       binding the composer tile never resolved any of them and always fell
       through to the generic branch. -->
  <button
    type="button"
    bind:this={tile}
    class="relative shrink-0 overflow-hidden rounded-md border border-border/50 bg-muted"
    style="width:{dimension}px;height:{dimension}px"
    onclick={open}
    title={nameVal}
  >
    {#if kind === 'image'}
      {#if imgError}
        <AppIcons.image_off class="m-auto size-5 text-muted-foreground" />
      {:else if preview}
        <img src={preview} alt={nameVal} class="size-full object-cover" onerror={() => (imgError = true)} />
      {:else}
        <AppIcons.image class="m-auto size-5 text-muted-foreground" />
      {/if}
    {:else if kind === 'video'}
      {#if thumbUrl}
        <img src={thumbUrl} alt={nameVal} class="size-full object-cover" />
      {:else if placeholder}
        <img src={placeholder} alt="" class="size-full scale-110 object-cover blur-lg" />
      {:else}
        <AppIcons.film class="m-auto size-5 text-muted-foreground" />
      {/if}
      <!-- Play affordance, always on top of the poster. -->
      <span class="absolute inset-0 flex items-center justify-center">
        <AppIcons.play_round class="size-6 text-white/90 drop-shadow" />
      </span>
      {#if meta.durationMs}
        <span class="absolute right-0.5 bottom-0.5 rounded bg-black/65 px-1 text-[9px] leading-[13px] font-medium text-white tabular-nums">
          {badgeDuration(meta.durationMs)}
        </span>
      {/if}
    {:else if kind === 'audio'}
      <span class="flex size-full flex-col items-center justify-center gap-1">
        <span class="flex items-end gap-px" aria-hidden="true">
          {#each WAVE_BARS as h, i (i)}
            <span class="w-0.5 rounded-full bg-primary/60" style="height:{h}px"></span>
          {/each}
        </span>
        {#if meta.durationMs}
          <span class="text-[9px] leading-none text-muted-foreground tabular-nums">{formatDuration(meta.durationMs)}</span>
        {/if}
      </span>
    {:else}
      <!-- document / archive / other: the type's own glyph + extension, so
           zip / pdf / docx / xlsx are distinguishable at a glance. -->
      <span class="flex size-full flex-col items-center justify-center gap-0.5 text-muted-foreground">
        {@render FileGlyph('size-5 text-primary')}
        <span class="max-w-full truncate px-0.5 text-[9px] leading-none font-medium">{extLabel}</span>
      </span>
    {/if}
  </button>
{:else}
  <!-- inline bubble attachment -->
  <div class="flex flex-wrap gap-2">
    {#if kind === 'image'}
      {#if imgError}
        <button type="button" class="flex items-center gap-2 rounded-md border border-border/40 px-2.5 py-1.5 text-meta text-muted-foreground" onclick={() => (openViewer(viewRef), onTap?.())}>
          <AppIcons.image_off class="size-4" /> {nameVal}
        </button>
      {:else}
        <button
          type="button"
          bind:this={tile}
          class="relative overflow-hidden rounded-md border border-border/50 bg-muted"
          style={ratio ? `aspect-ratio:${ratio};max-height:16rem` : 'min-width:8rem;min-height:6rem'}
          onclick={open}
          aria-label={nameVal}
          title={nameVal}
        >
          {#if placeholder && !preview}
            <img src={placeholder} alt="" class="absolute inset-0 size-full scale-110 object-cover blur-lg" />
          {/if}
          {#if preview}
            <img src={preview} onerror={() => (imgError = true)} alt={nameVal} class="max-h-64 cursor-zoom-in rounded-md" />
          {/if}
        </button>
      {/if}
    {:else if kind === 'video'}
      {#if shown}
        <video src={shown} controls preload="metadata" poster={thumbUrl} class="max-h-72 rounded-md border border-border/50"><track kind="captions" /></video>
      {:else}
        <button
          type="button"
          bind:this={tile}
          class="relative flex items-center justify-center overflow-hidden rounded-md border border-border/50 bg-muted"
          style={ratio ? `aspect-ratio:${ratio};width:min(100%,20rem)` : 'width:16rem;height:9rem'}
          onclick={open}
          title={nameVal}
        >
          {#if placeholder && !thumbUrl}
            <img src={placeholder} alt="" class="absolute inset-0 size-full scale-110 object-cover blur-lg" />
          {/if}
          {#if thumbUrl}
            <img src={thumbUrl} alt={nameVal} class="absolute inset-0 size-full object-cover" />
          {/if}
          <AppIcons.play_round class="relative size-10 text-white/90 drop-shadow" />
          {#if meta.durationMs}
            <!-- Duration badge, IM-standard (bottom-right of the poster). -->
            <span class="absolute right-1.5 bottom-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] leading-none font-medium text-white tabular-nums">
              {badgeDuration(meta.durationMs)}
            </span>
          {/if}
        </button>
      {/if}
    {:else if kind === 'audio'}
      {#if shown}
        <audio src={shown} controls class="w-full min-w-56"></audio>
      {:else}
        <button type="button" bind:this={tile} class="flex h-9 w-full min-w-56 items-center gap-2 rounded-md border border-border/50 bg-muted/50 px-3 text-meta" onclick={open} title={nameVal}>
          <AppIcons.play_round class="size-5 shrink-0" />
          <!-- Decorative pseudo-waveform: a fixed, deterministic bar pattern
               (no audio analysis available) so an audio card reads as audio at
               a glance and keeps the same height as every other chip. -->
          <span class="flex h-4 flex-1 items-center gap-px overflow-hidden" aria-hidden="true">
            {#each WAVE_BARS_WIDE as h, i (i)}
              <span class="w-0.5 shrink-0 rounded-full bg-muted-foreground/40" style="height:{h}px"></span>
            {/each}
          </span>
          {#if meta.durationMs}<span class="shrink-0 text-micro text-muted-foreground tabular-nums">{formatDuration(meta.durationMs)}</span>{/if}
        </button>
      {/if}
    {:else}
      <!-- document / previewable / generic file chip.
           FIXED HEIGHT (h-9): the chip is a flex row whose optional parts
           (size, eye/download affordance, download progress) must not change
           its height as they appear — an inline chip that reflows shifts every
           following card, unlike the image/video boxes which are locked by
           aspect-ratio. -->
      <button
        type="button"
        bind:this={tile}
        class="flex h-9 items-center gap-2 rounded-md border border-border/50 bg-muted/50 px-2.5 text-meta hover:bg-muted disabled:opacity-60"
        disabled={dlPct !== null}
        onclick={canView ? open : () => void download()}
        title={nameVal}
      >
        {@render FileGlyph('size-4 shrink-0 text-primary')}
        <span class="max-w-56 truncate">{nameVal}</span>
        {#if size}<span class="shrink-0 text-micro text-muted-foreground">{formatBytes(size)}</span>{/if}
        {#if dlPct !== null}
          <!-- Streaming to disk: percent when the total is known, otherwise a
               spinner. Shown IN PLACE of the affordance so the width (and thus
               the layout) stays put. -->
          {#if dlPct >= 0}
            <span class="shrink-0 text-micro text-muted-foreground tabular-nums">{dlPct}%</span>
          {:else}
            <span class="block size-3.5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
          {/if}
        {:else if canView}
          <AppIcons.eye class="size-3.5 shrink-0 text-muted-foreground" />
        {:else}
          <AppIcons.download class="size-3.5 shrink-0 text-muted-foreground" />
        {/if}
      </button>
    {/if}
  </div>
{/if}

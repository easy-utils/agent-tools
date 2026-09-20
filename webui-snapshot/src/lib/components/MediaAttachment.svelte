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
    downloadFile,
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
    fileProp != null &&
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
    } else if (shown) {
      window.open(shown, '_blank')
    }
  }

  const iconSlot = $derived(fileIconSlot(mimeVal, nameVal))
</script>

{#snippet FileGlyph(cls: string)}
  {@const C = AppIcons[iconSlot]}
  <C class={cls} />
{/snippet}

{#if dimension}
  <!-- composer tile -->
  <button
    type="button"
    class="relative shrink-0 overflow-hidden rounded-md border border-border/50 bg-muted"
    style="width:{dimension}px;height:{dimension}px"
    onclick={open}
    disabled={!shown && !thumbUrl}
  >
    {#if kind === 'image' && preview}
      {#if imgError}
        <AppIcons.image_off class="m-auto size-5 text-muted-foreground" />
      {:else}
        <img src={preview} alt={nameVal} class="size-full object-cover" onerror={() => (imgError = true)} />
      {/if}
    {:else if shown && kind === 'audio'}
      <AppIcons.music class="m-auto size-5 text-muted-foreground" />
    {:else if shown && kind === 'video'}
      {#if thumbUrl}
        <img src={thumbUrl} alt={nameVal} class="size-full object-cover" />
      {:else}
        <AppIcons.film class="m-auto size-5 text-muted-foreground" />
      {/if}
    {:else}
      <span class="flex size-full flex-col items-center justify-center gap-0.5 text-micro text-muted-foreground">
        <AppIcons.file class="size-4" />
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
        </button>
      {/if}
    {:else if kind === 'audio'}
      {#if shown}
        <audio src={shown} controls class="w-full min-w-56"></audio>
      {:else}
        <button type="button" bind:this={tile} class="flex w-full min-w-56 items-center gap-2 rounded-md border border-border/50 bg-muted/50 px-3 py-2 text-meta" onclick={open}>
          <AppIcons.play_round class="size-5" />
          <span class="min-w-0 flex-1 truncate">{nameVal}</span>
          {#if meta.durationMs}<span class="text-micro text-muted-foreground">{formatDuration(meta.durationMs)}</span>{/if}
        </button>
      {/if}
    {:else}
      <!-- document / previewable / generic file chip -->
      <button
        type="button"
        bind:this={tile}
        class="flex items-center gap-2 rounded-md border border-border/50 bg-muted/50 px-2.5 py-1.5 text-meta hover:bg-muted"
        onclick={canView ? open : () => void downloadFile(api, codeVal, nameVal)}
      >
        {@render FileGlyph('size-4 text-primary')}
        <span class="max-w-56 truncate">{nameVal}</span>
        {#if size}<span class="text-micro text-muted-foreground">{formatBytes(size)}</span>{/if}
        {#if canView}
          <AppIcons.eye class="size-3.5 text-muted-foreground" />
        {:else}
          <AppIcons.download class="size-3 text-muted-foreground" />
        {/if}
      </button>
    {/if}
  </div>
{/if}

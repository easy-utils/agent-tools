<script lang="ts">
  // PageHeader — the single canonical top bar for every page/panel:
  // 48px tall, 8px horizontal padding, a full-strength bottom border, and a
  // consistent gap.
  //
  // Slot order (left → right): `left` · back button · `leading` · `title` ·
  // `children` · `right`.
  //
  // IMPORTANT: `title` and the default children are rendered TOGETHER — an
  // earlier version used `{#if children}…{:else if title}` which silently
  // DROPPED the title for every caller that passed both (e.g. a title plus a
  // trailing action button). Pass `leading` for content that must sit BEFORE
  // the title (e.g. Mailbox's inbox glyph).
  import type { Snippet } from 'svelte'
  import { AppIcons } from '$lib/icons'
  import { cn } from '$lib/utils'

  let {
    title = '',
    /** Render the standard back button; supply the handler. */
    onBack = null,
    class: className,
    left,
    /** Rendered after the back button and BEFORE the title. */
    leading,
    right,
    children,
  }: {
    title?: string
    onBack?: (() => void) | null
    class?: string
    left?: Snippet
    leading?: Snippet
    right?: Snippet
    children?: Snippet
  } = $props()
</script>

<header
  class={cn('flex h-12 shrink-0 items-center gap-2 border-b border-border px-2', className)}
>
  {#if left}{@render left()}{/if}
  {#if onBack}
    <button type="button" class="rounded p-1.5 hover:bg-muted" aria-label="back" onclick={onBack}>
      <AppIcons.back class="size-[18px]" />
    </button>
  {/if}
  {#if leading}{@render leading()}{/if}
  {#if title}
    <span class="min-w-0 flex-1 truncate text-base font-semibold">{title}</span>
  {/if}
  {@render children?.()}
  {#if right}{@render right()}{/if}
</header>

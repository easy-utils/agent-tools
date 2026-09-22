<script lang="ts">
  // IconButton — the canonical icon button: a 14px hit area (p-1.5) around an
  // 18px glyph. `variant='primary'` tints it; `variant='destructive'` reddens.
  import type { Component, Snippet } from 'svelte'
  import { cn } from '$lib/utils'

  let {
    icon,
    label = '',
    onclick,
    variant = 'ghost',
    disabled = false,
    class: className,
    children,
  }: {
    icon?: Component<{ class?: string }>
    label?: string
    onclick?: () => void
    variant?: 'ghost' | 'primary' | 'destructive'
    disabled?: boolean
    class?: string
    children?: Snippet
  } = $props()
</script>

<button
  type="button"
  class={cn(
    'rounded p-1.5 hover:bg-muted',
    variant === 'ghost' && 'text-muted-foreground',
    variant === 'primary' && 'text-primary',
    variant === 'destructive' && 'text-destructive',
    'disabled:opacity-40',
    className,
  )}
  title={label || undefined}
  aria-label={label || undefined}
  {disabled}
  {onclick}
>
  {@render children?.()}{#if icon}{@const I = icon}<I class="size-[18px]" />{/if}
</button>

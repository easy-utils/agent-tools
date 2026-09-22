<script lang="ts">
  // EmptyState — the canonical centered placeholder ("No sessions", "No tags",
  // "Pick a branch on the left", …). `center` fills the available height, used
  // when the empty state IS the whole pane.
  import type { Snippet } from 'svelte'
  import { cn } from '$lib/utils'

  let {
    center = false,
    class: className,
    children,
  }: { center?: boolean; class?: string; children?: Snippet } = $props()
</script>

<div
  class={cn(
    'p-4 text-center text-meta text-muted-foreground',
    center && 'flex flex-1 items-center justify-center p-6',
    className,
  )}
>
  {@render children?.()}
</div>

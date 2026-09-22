<script lang="ts">
  // SectionLabel — the 10px uppercase tracking-wider group label above a set
  // of rows ("Recent", "Comments · 3", a category name, …).
  import type { Snippet } from 'svelte'
  import { cn } from '$lib/utils'

  let { class: className, children }: { class?: string; children?: Snippet } = $props()
</script>

<div
  class={cn(
    'px-4 py-2 text-micro font-semibold tracking-wider text-muted-foreground uppercase',
    className,
  )}
>
  {@render children?.()}
</div>

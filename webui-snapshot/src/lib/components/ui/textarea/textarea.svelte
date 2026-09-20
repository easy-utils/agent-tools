<script lang="ts">
  import { cn } from '$lib/utils'
  import type { Snippet } from 'svelte'
  import type { HTMLTextareaAttributes } from 'svelte/elements'

  let {
    class: className,
    value = $bindable(''),
    rows = 3,
    children,
    ...rest
  }: HTMLTextareaAttributes & {
    class?: string
    value?: string
    children?: Snippet
  } = $props()
</script>

<textarea bind:value rows={rows} class={cn('w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50', className)} {...rest}></textarea>

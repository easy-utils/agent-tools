<script lang="ts">
  // Styled DropdownMenu item + separator wrappers (shared chrome from the index).
  import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui'
  import { cn } from '$lib/utils'
  import type { Snippet } from 'svelte'

  let {
    class: className,
    children,
    onSelect,
    disabled,
  }: {
    class?: string
    children?: Snippet
    onSelect?: (e: Event) => void
    disabled?: boolean
  } = $props()
</script>

<DropdownMenuPrimitive.Item
  {disabled}
  onSelect={e => {
    e.preventDefault()
    onSelect?.(e)
  }}
  class={cn(
    'relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none',
    'data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
    className,
  )}
>
  {@render children?.()}
</DropdownMenuPrimitive.Item>

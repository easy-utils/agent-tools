<script lang="ts">
  // shadcn-svelte-style Popover (bits-ui) used for anchored composers/menus.
  import { Popover as PopoverPrimitive } from 'bits-ui'
  import type { Snippet } from 'svelte'
  import { cn } from '$lib/utils'

  let {
    trigger,
    children,
    side = 'bottom',
    align = 'end',
    class: className,
  }: {
    trigger: Snippet
    children: Snippet
    side?: 'top' | 'bottom' | 'left' | 'right'
    align?: 'start' | 'center' | 'end'
    class?: string
  } = $props()
</script>

<PopoverPrimitive.Root>
  <PopoverPrimitive.Trigger>{@render trigger()}</PopoverPrimitive.Trigger>
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      {side}
      {align}
      sideOffset={6}
      class={cn(
        'z-50 w-max rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none',
        className,
      )}
    >
      {@render children()}
    </PopoverPrimitive.Content>
  </PopoverPrimitive.Portal>
</PopoverPrimitive.Root>

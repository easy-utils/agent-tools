<script lang="ts">
  // shadcn-svelte-style Tooltip (bits-ui) wrapping an icon trigger.
  import { Tooltip as TooltipPrimitive } from 'bits-ui'
  import type { Snippet } from 'svelte'

  let {
    content,
    children,
    side = 'bottom',
  }: {
    content: string
    children: Snippet
    side?: 'top' | 'bottom' | 'left' | 'right'
  } = $props()

  // A shared provider adds a small open delay like the plain title tooltips.
  const providerProps = { delayDuration: 300 }
</script>

<TooltipPrimitive.Provider {...providerProps}>
  <TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger>{@render children()}</TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        {side}
        sideOffset={6}
        class="z-50 rounded-md bg-popover px-2 py-1 text-micro text-popover-foreground shadow-md outline-none"
      >
        {content}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>
</TooltipPrimitive.Provider>

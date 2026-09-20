<script lang="ts">
  // shadcn-svelte-style DropdownMenu (bits-ui) + a thin `DropdownMenuItem`
  // wrapper that carries the shared item styling.
  import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui'
  import { AppIcons } from '$lib/icons'
  import type { Snippet } from 'svelte'
  import { cn } from '$lib/utils'

  let {
    trigger,
    children,
    class: className,
    label,
  }: {
    /** Optional custom trigger; defaults to a ⋯ icon button. */
    trigger?: Snippet
    children: Snippet
    class?: string
    label?: string
  } = $props()
</script>

<DropdownMenuPrimitive.Root>
  <DropdownMenuPrimitive.Trigger
    class="rounded px-2 py-1.5 text-muted-foreground outline-none hover:bg-muted data-[state=open]:bg-muted"
    aria-label={label ?? 'menu'}
  >
    {#if trigger}
      {@render trigger()}
    {:else}
      <AppIcons.more_vertical class="size-4" />
    {/if}
  </DropdownMenuPrimitive.Trigger>
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      class={cn(
        'z-50 min-w-44 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg',
        className,
      )}
      sideOffset={6}
      align="end"
    >
      {@render children()}
    </DropdownMenuPrimitive.Content>
  </DropdownMenuPrimitive.Portal>
</DropdownMenuPrimitive.Root>

<script lang="ts">
  // shadcn-svelte-style Select (bits-ui) with a native-like trigger.
  import { Select as SelectPrimitive } from 'bits-ui'
  import { AppIcons } from '$lib/icons'
  import { cn } from '$lib/utils'

  let {
    value = $bindable(''),
    items = [],
    placeholder = '',
    class: className,
    disabled = false,
    onchange,
  }: {
    value?: string
    items?: { value: string; label: string }[]
    placeholder?: string
    class?: string
    disabled?: boolean
    onchange?: (v: string) => void
  } = $props()
</script>

<SelectPrimitive.Root
  type="single"
  {items}
  {disabled}
  bind:value
  onValueChange={v => onchange?.(v ?? '')}
>
  <SelectPrimitive.Trigger
    class={cn(
      'flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none',
      'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
      className,
    )}
  >
    <SelectPrimitive.Value {placeholder} />
    <AppIcons.chevron_down class="size-3.5 shrink-0 text-muted-foreground" />
  </SelectPrimitive.Trigger>
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      class="z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
      sideOffset={4}
    >
      <SelectPrimitive.Viewport class="p-1">
        {#each items as item (item.value)}
          <SelectPrimitive.Item
            value={item.value}
            label={item.label}
            class="flex w-full cursor-default items-start gap-2 rounded-sm px-2 py-1.5 text-sm break-all whitespace-normal outline-none select-none data-[highlighted]:bg-muted data-[disabled]:opacity-50"
          >
            <AppIcons.check class="mt-0.5 size-3.5 shrink-0 opacity-0 group-data-[state=checked]:opacity-100" />
            <span class="min-w-0 flex-1 break-all whitespace-normal">{item.label}</span>
          </SelectPrimitive.Item>
        {/each}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
</SelectPrimitive.Root>

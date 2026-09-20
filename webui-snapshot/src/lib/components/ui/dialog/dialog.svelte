<script lang="ts">
  // shadcn-svelte-style Dialog (bits-ui primitive) with the shared card chrome.
  import { Dialog as DialogPrimitive } from 'bits-ui'
  import { AppIcons } from '$lib/icons'
  import type { Snippet } from 'svelte'
  import { cn } from '$lib/utils'

  let {
    open = $bindable(false),
    title = '',
    description = '',
    class: className,
    children,
    footer,
    onClose,
  }: {
    open?: boolean
    title?: string
    description?: string
    class?: string
    children?: Snippet
    footer?: Snippet
    onClose?: () => void
  } = $props()
</script>

<DialogPrimitive.Root bind:open onOpenChange={v => !v && onClose?.()}>
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      class="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
    />
    <DialogPrimitive.Content
      class={cn(
        'fixed top-1/2 left-1/2 z-50 grid w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 gap-3',
        'rounded-lg border border-border bg-card p-4 text-card-foreground shadow-xl outline-none',
        className,
      )}
    >
      {#if title}
        <DialogPrimitive.Title class="text-sm font-semibold">{title}</DialogPrimitive.Title>
      {/if}
      {#if description}
        <DialogPrimitive.Description class="text-meta text-muted-foreground">
          {description}
        </DialogPrimitive.Description>
      {/if}
      {@render children?.()}
      {#if footer}
        <div class="-mx-4 -mb-4 mt-1 flex justify-end gap-2 border-t border-border px-4 py-3">
          {@render footer?.()}
        </div>
      {/if}
      <DialogPrimitive.Close
        class="absolute top-3 right-3 rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100"
        aria-label="Close"
      >
        <AppIcons.close class="size-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>

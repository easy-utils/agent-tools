<script lang="ts">
  // shadcn-svelte-style AlertDialog (confirm / destructive flows).
  import { AlertDialog as AlertDialogPrimitive } from 'bits-ui'
  import type { Snippet } from 'svelte'
  import { cn } from '$lib/utils'

  let {
    open = $bindable(false),
    title = '',
    body = '',
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
    destructive = false,
    onConfirm,
    onCancel,
  }: {
    open?: boolean
    title?: string
    body?: string
    confirmLabel?: string
    cancelLabel?: string
    destructive?: boolean
    onConfirm?: () => void
    onCancel?: () => void
  } = $props()
</script>

<AlertDialogPrimitive.Root bind:open>
  <AlertDialogPrimitive.Portal>
    <AlertDialogPrimitive.Overlay class="fixed inset-0 z-50 bg-black/50" />
    <AlertDialogPrimitive.Content
      class={cn(
        'fixed top-1/2 left-1/2 z-50 grid w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 gap-3',
        'rounded-lg border border-border bg-card p-4 text-card-foreground shadow-xl outline-none',
      )}
    >
      <AlertDialogPrimitive.Title class="text-sm font-semibold">{title}</AlertDialogPrimitive.Title>
      {#if body}
        <AlertDialogPrimitive.Description class="text-meta text-muted-foreground">
          {body}
        </AlertDialogPrimitive.Description>
      {/if}
      <div class="mt-1 flex justify-end gap-2">
        <AlertDialogPrimitive.Cancel
          class="rounded-md px-3 py-1.5 text-sm hover:bg-muted"
          onclick={() => onCancel?.()}
        >{cancelLabel}</AlertDialogPrimitive.Cancel>
        <AlertDialogPrimitive.Action
          class={cn(
            'rounded-md px-3 py-1.5 text-sm',
            destructive
              ? 'bg-destructive text-white hover:bg-destructive/80'
              : 'bg-primary text-primary-foreground hover:bg-primary/80',
          )}
          onclick={() => onConfirm?.()}
        >{confirmLabel}</AlertDialogPrimitive.Action>
      </div>
    </AlertDialogPrimitive.Content>
  </AlertDialogPrimitive.Portal>
</AlertDialogPrimitive.Root>

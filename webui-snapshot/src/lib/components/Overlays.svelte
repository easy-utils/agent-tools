<script lang="ts">
  // Global overlay host: prompt / confirm / action-sheet dialogs + toasts,
  // all rendered with the shadcn-svelte (bits-ui) primitives.
  import { Dialog } from '$lib/components/ui/dialog'
  import { AlertDialog } from '$lib/components/ui/alert-dialog'
  import { Input } from '$lib/components/ui/input'
  import { Textarea } from '$lib/components/ui/textarea'
  import { actionSheet as actionSheetStore, overlays, resolveConfirm, resolveDialog, resolveSheet } from '$lib/overlays.svelte'
  import { cn } from '$lib/utils'

  let promptValue = $state('')

  const dialogOpen = $derived(overlays.dialog != null)
  const confirmOpen = $derived(overlays.confirm != null)
  const sheetOpen = $derived(overlays.sheet != null)

  $effect(() => {
    if (overlays.dialog) promptValue = overlays.dialog.initial
  })
</script>

<!-- prompt dialog -->
<Dialog
  open={dialogOpen}
  title={overlays.dialog?.title ?? ''}
  description={overlays.dialog?.body}
  onClose={() => resolveDialog(null)}
>
  {#snippet children()}
    {#if overlays.dialog?.multiline}
      <Textarea bind:value={promptValue} rows={4} placeholder={overlays.dialog?.placeholder} />
    {:else}
      <Input bind:value={promptValue} placeholder={overlays.dialog?.placeholder} />
    {/if}
  {/snippet}
  {#snippet footer()}
    <button
      type="button"
      class="rounded-md px-3 py-1.5 text-sm hover:bg-muted"
      onclick={() => resolveDialog(null)}
    >{overlays.dialog?.cancelLabel ?? 'Cancel'}</button>
    <button
      type="button"
      class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/80"
      onclick={() => resolveDialog(promptValue.trim())}
    >{overlays.dialog?.confirmLabel ?? 'OK'}</button>
  {/snippet}
</Dialog>

<!-- confirm dialog -->
<AlertDialog
  open={confirmOpen}
  title={overlays.confirm?.title ?? ''}
  body={overlays.confirm?.body ?? ''}
  confirmLabel={overlays.confirm?.confirmLabel ?? 'OK'}
  cancelLabel={overlays.confirm?.cancelLabel ?? 'Cancel'}
  destructive={overlays.confirm?.destructive ?? false}
  onConfirm={() => resolveConfirm(true)}
  onCancel={() => resolveConfirm(false)}
/>

<!-- action sheet -->
<AlertDialog
  open={sheetOpen}
  title={overlays.sheet?.title ?? ''}
  cancelLabel=""
  onCancel={() => resolveSheet(null)}
>
</AlertDialog>

{#if overlays.sheet}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onclick={() => resolveSheet(null)} onkeydown={e => e.key === 'Escape' && resolveSheet(null)}>
    <div
      class="w-[min(92vw,360px)] rounded-lg border border-border bg-card p-2 shadow-xl"
      role="presentation"
      onclick={e => e.stopPropagation()}
    >
      <div class="px-3 py-2 text-sm font-semibold">{overlays.sheet.title}</div>
      {#each overlays.sheet.actions as a (a.value)}
        <button
          type="button"
          class={cn('flex w-full items-center rounded-sm px-3 py-2.5 text-left text-body hover:bg-muted', a.destructive && 'text-destructive')}
          onclick={() => resolveSheet(a.value)}
        >{a.label}</button>
      {/each}
    </div>
  </div>
{/if}

<!-- toasts -->
<div class="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4">
  {#each overlays.toasts as toast (toast.id)}
    <button
      class={cn(
        'pointer-events-auto max-w-[90vw] rounded-md border px-4 py-2 text-sm shadow-lg',
        toast.error
          ? 'border-destructive/40 bg-destructive text-white'
          : 'border-border bg-popover text-popover-foreground',
      )}
      onclick={() => (overlays.toasts = overlays.toasts.filter(t => t.id !== toast.id))}
    >{toast.text}</button>
  {/each}
</div>

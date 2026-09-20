<script lang="ts">
  import { overlays, dismissToast } from './overlays.svelte'
  const getToasts = () => overlays.toasts
  import { cn } from '$lib/utils'

  let items = $derived(getToasts())
</script>

<div class="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4">
  {#each items as t (t.id)}
    <button
      class={cn(
        'pointer-events-auto max-w-[90vw] rounded-md border px-4 py-2 text-sm shadow-lg transition-opacity',
        t.error
          ? 'border-destructive/40 bg-destructive text-destructive-foreground'
          : 'border-border bg-popover text-popover-foreground',
      )}
      onclick={() => dismissToast(t.id)}
    >
      {t.text}
    </button>
  {/each}
</div>

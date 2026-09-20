<script lang="ts">
  import { cn } from '$lib/utils'

  let {
    checked = $bindable(false),
    disabled = false,
    onchange,
  }: {
    checked?: boolean
    disabled?: boolean
    onchange?: (v: boolean) => void
  } = $props()
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  {disabled}
  class={cn(
    'inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors outline-none',
    'focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
    checked ? 'bg-primary' : 'bg-input',
  )}
  aria-label="toggle"
  onclick={() => {
    checked = !checked
    onchange?.(checked)
  }}
>
  <span
    class={cn(
      'pointer-events-none block size-4 rounded-full bg-background shadow transition-transform',
      checked ? 'translate-x-[18px]' : 'translate-x-0.5',
    )}
  ></span>
</button>

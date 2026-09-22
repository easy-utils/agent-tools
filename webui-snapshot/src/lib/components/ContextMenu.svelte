<script lang="ts">
  // ContextMenu — a small menu anchored to the ROW it acts on (desktop
  // right-click / mobile long-press on a list item). Anchoring to the row
  // rather than the raw pointer point is deliberate: with dozens of visually
  // identical rows a cursor-positioned menu gives no clue which item it acts
  // on, so the menu is vertically centred on the row, right-aligned to the
  // row's trailing edge, and the caller highlights the source row while open.
  //
  // Closes on: item pick, outside pointerdown, Escape, any scroll, resize.
  // The position is clamped into the viewport after mount.
  import { computeMenuPosition, type MenuAnchor } from '$lib/context-menu-position'
  import { cn } from '$lib/utils'

  export interface ContextMenuItem {
    value: string
    label: string
    destructive?: boolean
  }

  let {
    anchor,
    items,
    onPick,
    onClose,
  }: {
    anchor: MenuAnchor
    items: ContextMenuItem[]
    onPick: (value: string) => void
    onClose: () => void
  } = $props()

  let el = $state<HTMLDivElement | null>(null)

  // Place once the menu's real size is known (and again whenever that size
  // changes): right-aligned to the row's trailing edge, vertically centred on
  // the row, clamped into the viewport. The size is not stable on first paint
  // — the self-hosted CJK font can swap in after mount and change the text
  // width, which would leave the menu a few px off the row's edge — so a
  // ResizeObserver (+ fonts.ready) re-runs the placement instead of a one-shot
  // measurement. The menu never MOVES by user action (it is remounted per
  // open), so an imperative style update is enough — no reactive state.
  $effect(() => {
    if (!el) return
    const node = el
    const place = () => {
      const r = node.getBoundingClientRect()
      const { top, left } = computeMenuPosition(
        anchor,
        { width: r.width, height: r.height },
        { width: window.innerWidth, height: window.innerHeight },
      )
      node.style.top = `${top}px`
      node.style.left = `${left}px`
    }
    place()
    const raf = requestAnimationFrame(place)
    // Belt and braces: the natural width can settle one layout pass later
    // (font swap / min-width), and ResizeObserver can miss the very first
    // change on some engines — one delayed idempotent re-place converges.
    const settle = setTimeout(place, 50)
    const ro = new ResizeObserver(place)
    ro.observe(node)
    void document.fonts?.ready.then(place).catch(() => {})
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(settle)
      ro.disconnect()
    }
  })

  function onWindowPointerdown(e: PointerEvent) {
    if (el && !el.contains(e.target as Node)) onClose()
  }
</script>

<svelte:window
  onpointerdown={onWindowPointerdown}
  onkeydown={(e) => e.key === 'Escape' && onClose()}
  onscroll={onClose}
  onresize={onClose}
/>

<div
  bind:this={el}
  class="fixed z-50 min-w-44 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
  style="top:0; left:0"
  role="menu"
>
  {#each items as it (it.value)}
    <button
      type="button"
      role="menuitem"
      class={cn(
        'relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-muted',
        it.destructive && 'text-destructive',
      )}
      onclick={() => onPick(it.value)}
    >
      {it.label}
    </button>
  {/each}
</div>

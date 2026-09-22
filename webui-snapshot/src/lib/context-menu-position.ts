// Pure geometry for the row-anchored ContextMenu. Extracted so the placement
// rules (vertical centring on the source row, right-alignment to its trailing
// edge, viewport clamping) are unit-testable without a DOM.
//
// Why row-anchored (not cursor-anchored): session lists have dozens of
// near-identical rows, so a menu placed at the raw pointer position gives no
// clue which row it acts on. Anchoring to the row + highlighting it removes
// the ambiguity.

/** The source row's viewport rect (anchor for the menu). */
export interface MenuAnchor {
  top: number
  bottom: number
  left: number
  right: number
}

/** The menu's measured size. */
export interface MenuSize {
  width: number
  height: number
}

/** The viewport. */
export interface Viewport {
  width: number
  height: number
}

/** Keep at least this much gap from every viewport edge. */
const EDGE = 8

/**
 * Compute the menu's fixed-position `top`/`left`:
 *  - vertically CENTRED on the anchor row;
 *  - right-aligned to the row's trailing edge;
 *  - clamped so the whole menu stays inside the viewport (with an EDGE margin).
 */
export function computeMenuPosition(
  anchor: MenuAnchor,
  menu: MenuSize,
  viewport: Viewport,
): { top: number; left: number } {
  const rowCenterY = (anchor.top + anchor.bottom) / 2
  let top = rowCenterY - menu.height / 2
  top = clamp(top, EDGE, viewport.height - menu.height - EDGE)
  let left = anchor.right - menu.width
  left = clamp(left, EDGE, viewport.width - menu.width - EDGE)
  return { top, left }
}

function clamp(v: number, lo: number, hi: number): number {
  // When the menu is larger than the space, prefer the TOP-LEFT margin
  // (Math.max after Math.min would otherwise push it off-screen).
  return Math.max(lo, Math.min(v, Math.max(lo, hi)))
}

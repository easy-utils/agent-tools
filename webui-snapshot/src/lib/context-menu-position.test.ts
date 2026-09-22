// ContextMenu placement geometry: the menu must sit centred on the source
// ROW and right-aligned to its trailing edge (so it is visually attached to
// the row it acts on, not the pointer), and stay inside the viewport.
import { describe, expect, it } from 'vitest'
import { computeMenuPosition } from './context-menu-position'

const VP = { width: 1280, height: 800 }
const MENU = { width: 176, height: 74 }

describe('computeMenuPosition (row-anchored context menu)', () => {
  it('vertically centres the menu on the row', () => {
    const row = { top: 200, bottom: 264, left: 0, right: 400 }
    const { top } = computeMenuPosition(row, MENU, VP)
    expect(top + MENU.height / 2).toBeCloseTo((row.top + row.bottom) / 2)
  })

  it('right-aligns the menu to the row trailing edge', () => {
    const row = { top: 200, bottom: 264, left: 0, right: 400 }
    const { left } = computeMenuPosition(row, MENU, VP)
    expect(left + MENU.width).toBeCloseTo(row.right)
  })

  it('clamps to the viewport top edge (row at the very top)', () => {
    const row = { top: 0, bottom: 64, left: 100, right: 400 }
    const { top } = computeMenuPosition(row, MENU, VP)
    expect(top).toBe(8)
  })

  it('clamps to the viewport bottom edge (row at the very bottom)', () => {
    const row = { top: 780, bottom: 844, left: 100, right: 400 }
    const { top } = computeMenuPosition(row, MENU, VP)
    expect(top + MENU.height).toBeLessThanOrEqual(VP.height - 8 + 0.001)
  })

  it('clamps to the viewport left edge (narrow row near x=0)', () => {
    const row = { top: 200, bottom: 264, left: 0, right: 40 }
    const { left } = computeMenuPosition(row, MENU, VP)
    expect(left).toBe(8)
  })

  it('clamps into the viewport for a wide row whose right edge is off-screen', () => {
    const row = { top: 200, bottom: 264, left: 0, right: 2000 }
    const { left } = computeMenuPosition(row, MENU, VP)
    expect(left + MENU.width).toBeLessThanOrEqual(VP.width - 8 + 0.001)
  })

  it('keeps a deterministic (top-left) position when the menu exceeds the viewport', () => {
    const tiny = { width: 120, height: 90 }
    const row = { top: 50, bottom: 80, left: 0, right: 100 }
    const { top, left } = computeMenuPosition(
      row,
      { width: 300, height: 200 },
      tiny,
    )
    expect(top).toBe(8)
    expect(left).toBe(8)
  })
})

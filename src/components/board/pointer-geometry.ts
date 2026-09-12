/**
 * Pure hit-testing math for the pointer-based drag engine (use-drag-controller.tsx). Kept free of
 * any DOM/React dependency so it can be unit-tested with plain numbers — the engine itself reads
 * real `getBoundingClientRect()` values and hands them to this module as plain `{id, top, height}`
 * records.
 */

export interface RectLike {
  id: string
  top: number
  height: number
}

/**
 * Which index a pointer at `pointerY` should insert at, given each card's current on-screen rect,
 * already in visual (top-to-bottom) order. Uses each card's vertical midpoint as the swap
 * threshold: a pointer above a card's midpoint means "insert before it," at or below means
 * "insert after" (keep looking). Returns `rects.length` (append at the end) if the pointer is
 * below every card, and `0` for an empty column.
 */
export function indexForPointerY(rects: readonly RectLike[], pointerY: number): number {
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]
    if (!rect) continue
    const midpoint = rect.top + rect.height / 2
    if (pointerY < midpoint) return i
  }
  return rects.length
}

export interface BoxLike {
  left: number
  top: number
  right: number
  bottom: number
}

export function pointInBox(x: number, y: number, box: BoxLike): boolean {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
}

import { describe, expect, it } from 'vitest'

import { indexForPointerY, pointInBox, type RectLike } from '@/components/board/pointer-geometry'

describe('indexForPointerY', () => {
  it('is 0 for an empty column, regardless of pointer position', () => {
    expect(indexForPointerY([], 0)).toBe(0)
    expect(indexForPointerY([], 9999)).toBe(0)
  })

  const rects: RectLike[] = [
    { id: 'a', top: 0, height: 10 }, // spans 0-10, midpoint 5
    { id: 'b', top: 10, height: 10 }, // spans 10-20, midpoint 15
    { id: 'c', top: 20, height: 10 }, // spans 20-30, midpoint 25
  ]

  it('inserts before the first card when the pointer is above every midpoint', () => {
    expect(indexForPointerY(rects, -100)).toBe(0)
    expect(indexForPointerY(rects, 4.9)).toBe(0)
  })

  it('inserts after the last card when the pointer is below every midpoint', () => {
    expect(indexForPointerY(rects, 25.1)).toBe(3)
    expect(indexForPointerY(rects, 1000)).toBe(3)
  })

  it('inserts between two cards once the pointer passes the first card’s midpoint', () => {
    expect(indexForPointerY(rects, 5.1)).toBe(1)
    expect(indexForPointerY(rects, 15.1)).toBe(2)
  })

  it('treats exactly-at-midpoint as "at or after this card" (not "before it")', () => {
    // The comparison is a strict `<`, so landing exactly on a midpoint does not count as
    // "before" that card — it keeps looking, same as landing just below it.
    expect(indexForPointerY(rects, 5)).toBe(1)
    expect(indexForPointerY(rects, 25)).toBe(3)
  })

  it('a single-card column only ever returns 0 or 1', () => {
    const single: RectLike[] = [{ id: 'only', top: 100, height: 20 }]
    expect(indexForPointerY(single, 50)).toBe(0)
    expect(indexForPointerY(single, 150)).toBe(1)
  })
})

describe('pointInBox', () => {
  const box = { left: 0, top: 0, right: 100, bottom: 50 }

  it('is true for a point strictly inside', () => {
    expect(pointInBox(50, 25, box)).toBe(true)
  })

  it('is true on every edge — the box is inclusive', () => {
    expect(pointInBox(0, 25, box)).toBe(true)
    expect(pointInBox(100, 25, box)).toBe(true)
    expect(pointInBox(50, 0, box)).toBe(true)
    expect(pointInBox(50, 50, box)).toBe(true)
  })

  it('is false just outside each edge', () => {
    expect(pointInBox(-1, 25, box)).toBe(false)
    expect(pointInBox(101, 25, box)).toBe(false)
    expect(pointInBox(50, -1, box)).toBe(false)
    expect(pointInBox(50, 51, box)).toBe(false)
  })
})

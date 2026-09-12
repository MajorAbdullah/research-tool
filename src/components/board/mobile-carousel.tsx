'use client'

/**
 * Mobile board = swipeable column carousel (plan §10, P11.8), not a squeezed 5-column grid.
 * One column fills the viewport at a time; CSS scroll-snap gives real, native, momentum-correct
 * swipe for free — no gesture library, no fighting the OS's own touch-scroll physics, which a
 * hand-rolled pointer-tracked "swipe" would otherwise have to reimplement badly. A small tab strip
 * above the carousel gives quick direct navigation and shows which column is active; tapping a tab
 * scrolls to it, and scrolling the carousel updates the active tab, so the two stay in sync either
 * way.
 *
 * Deliberately NOT built on `@/components/ui/tabs`: that component conditionally renders only the
 * active panel (correct for ordinary tabbed content), which would remove every *other* column from
 * the DOM and make swiping between them impossible. The tab strip here is visually styled to match
 * it, but every column stays mounted and scrollable at all times.
 *
 * A useful side effect of keeping every column mounted side-by-side rather than branching on
 * device type: the drag controller (drag-controller.tsx) hit-tests against each column's *real*
 * screen rect, and an off-screen column (one page to the left/right) simply has no rect
 * overlapping the viewport — so a touch drag here can only ever land back in the one column
 * currently scrolled into view. Cross-column moves on mobile go through the status `<select>`
 * (also the keyboard path) instead, which is both simpler and — see the phase report — the same
 * choice production kanban apps make for exactly this "one column visible at a time" layout.
 */

import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { BoardColumn } from './board-column'
import type { BoardColumnConfig, ItemSummary, OutcomeNoteState } from './board-types'

export interface MobileCarouselProps {
  columns: readonly BoardColumnConfig[]
  itemsByColumn: ReadonlyMap<string, ItemSummary[]>
  selectedIds: ReadonlySet<string>
  onToggleSelect: (id: string) => void
  outcomeNotes: ReadonlyMap<string, OutcomeNoteState>
}

export function MobileCarousel({
  columns,
  itemsByColumn,
  selectedIds,
  onToggleSelect,
  outcomeNotes,
}: MobileCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef(new Map<number, HTMLElement>())
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    let frame = 0
    const handleScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const width = container.clientWidth || 1
        const index = Math.round(container.scrollLeft / width)
        setActiveIndex(Math.min(columns.length - 1, Math.max(0, index)))
      })
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      cancelAnimationFrame(frame)
    }
  }, [columns.length])

  function goToColumn(index: number): void {
    const el = pageRefs.current.get(index)
    el?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div
        role="tablist"
        aria-label="Board columns"
        className="flex gap-1 overflow-x-auto rounded-md bg-muted p-1"
      >
        {columns.map((column, index) => (
          <button
            key={column.key}
            type="button"
            role="tab"
            aria-selected={activeIndex === index}
            onClick={() => goToColumn(index)}
            className={cn(
              'inline-flex h-11 shrink-0 items-center justify-center rounded-sm px-3 text-sm font-medium whitespace-nowrap',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring',
              activeIndex === index
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {column.label}
            <span className="ml-1.5 text-xs text-muted-foreground">
              {(itemsByColumn.get(column.key) ?? []).length}
            </span>
          </button>
        ))}
      </div>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
      >
        {columns.map((column, index) => (
          <div
            key={column.key}
            ref={(el) => {
              if (el) pageRefs.current.set(index, el)
              else pageRefs.current.delete(index)
            }}
            className="w-full shrink-0 snap-start px-0.5"
          >
            <BoardColumn
              config={column}
              items={itemsByColumn.get(column.key) ?? []}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
              outcomeNotes={outcomeNotes}
              className="h-full border-none bg-transparent"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

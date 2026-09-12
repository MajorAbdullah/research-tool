'use client'

import { useEffect, useState } from 'react'
import { ListFilter, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDebouncedValue } from '@/components/library/use-debounced-value'
import type { GroupBy, LibrarySortMode } from '@/components/library/types'

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'All' },
  { value: 'kind', label: 'Kind' },
  { value: 'topic', label: 'Topic' },
  { value: 'status', label: 'Status' },
  { value: 'date', label: 'Date' },
]

const SORT_OPTIONS: { value: LibrarySortMode; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'recently_opened', label: 'Recently opened' },
]

export interface LibraryToolbarProps {
  q: string
  onQChange: (q: string) => void
  sort: LibrarySortMode
  onSortChange: (sort: LibrarySortMode) => void
  group: GroupBy
  onGroupChange: (group: GroupBy) => void
  activeFilterCount: number
  onOpenFilters: () => void
  isSearching: boolean
}

/**
 * Search bar + sort + group-by + filter trigger (deliverables #2, #3, #4, #5). One row that wraps
 * onto two on narrow screens rather than four separate toolbars — kept as one component so those
 * four controls can never independently drift in spacing/height.
 */
export function LibraryToolbar({
  q,
  onQChange,
  sort,
  onSortChange,
  group,
  onGroupChange,
  activeFilterCount,
  onOpenFilters,
  isSearching,
}: LibraryToolbarProps) {
  const [text, setText] = useState(q)
  // Render-time state adjustment (React's documented pattern for "resetting state when a prop
  // changes"), not an effect: an external change to `q` (back/forward navigation, "Clear all",
  // the debounce-commit below) resyncs the input's local buffer with no stale intermediate frame.
  const [prevQ, setPrevQ] = useState(q)
  if (q !== prevQ) {
    setPrevQ(q)
    setText(q)
  }

  const debounced = useDebouncedValue(text, 250)

  // Commit the debounced value upward once it settles and actually differs from what's committed.
  // This one stays a real effect — it synchronizes local state OUT to the parent/router, rather
  // than deriving this component's own state from a prop.
  useEffect(() => {
    if (debounced !== q) onQChange(debounced)
    // Only the debounced value should re-trigger this — the render-time adjustment above already
    // handles the reverse (external q -> local text) direction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-64">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search your library…"
            aria-label="Search your library"
            className="pl-9"
          />
          {text.length > 0 && (
            <button
              type="button"
              onClick={() => setText('')}
              aria-label="Clear search"
              className="absolute top-1/2 right-1 inline-flex size-touch -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>

        <Button variant="outline" onClick={onOpenFilters} className="relative">
          <ListFilter className="size-4" aria-hidden="true" />
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-0.5 inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </Button>

        {isSearching ? (
          <span className="hidden h-11 items-center px-1 text-sm text-muted-foreground sm:flex">
            Sorted by relevance
          </span>
        ) : (
          <div className="w-44 shrink-0">
            <Select
              aria-label="Sort"
              value={sort}
              onChange={(e) => onSortChange(e.target.value as LibrarySortMode)}
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {/* `defaultValue` is required by Tabs' type even in fully-controlled usage (see ui/tabs.tsx) — value always wins once provided. */}
      <Tabs
        defaultValue={group}
        value={group}
        onValueChange={(value) => onGroupChange(value as GroupBy)}
      >
        <TabsList aria-label="Group by">
          {GROUP_OPTIONS.map((opt) => (
            <TabsTrigger key={opt.value} value={opt.value}>
              {opt.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}

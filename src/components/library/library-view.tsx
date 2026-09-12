'use client'

import { useCallback, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { ActiveFilterChips } from '@/components/library/active-filter-chips'
import { FilterSheet } from '@/components/library/filter-rail'
import { LibraryGrid } from '@/components/library/library-grid'
import { LibraryToolbar } from '@/components/library/library-toolbar'
import {
  countActiveFilters,
  emptyLibraryQueryState,
  isFiltersEmpty,
  parseGroupBy,
  parseLibraryQueryState,
  serializeLibraryState,
} from '@/components/library/query-params'
import { useFilterFacets } from '@/components/library/use-filter-facets'
import { useLibraryItems } from '@/components/library/use-library-items'
import { EMPTY_FILTERS } from '@/components/library/types'
import type { GroupBy, ItemSummary, LibraryQueryState, WirePage } from '@/components/library/types'

export interface LibraryViewProps {
  /** Server-fetched first page for the URL the page was requested with — see use-library-items.ts. */
  initialPage: WirePage<ItemSummary> | null
  initialQueryKey: string
}

/**
 * Top-level client orchestrator for `/library`. Owns the one thing that has to live in a single
 * place: the URL as the source of truth for `q`/filters/sort/group (deliverable #3's "encoded in
 * the URL so a filtered view is shareable/bookmarkable" applies to all four, not just filters).
 * Every child below is a controlled, mostly-presentational component driven from this state.
 */
export function LibraryView({ initialPage, initialQueryKey }: LibraryViewProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const state = useMemo(() => parseLibraryQueryState(searchParams), [searchParams])
  const group = useMemo(() => parseGroupBy(searchParams), [searchParams])
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)

  const pushState = useCallback(
    (nextState: LibraryQueryState, nextGroup: GroupBy) => {
      const qs = serializeLibraryState(nextState, nextGroup).toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname],
  )

  const {
    items,
    isSearching,
    isRefiningSearch,
    isPending,
    isError,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetch,
  } = useLibraryItems({ state, initialPage, initialQueryKey })

  const { topics, tags } = useFilterFacets()

  const hasActiveFilters = !isFiltersEmpty(state.filters)

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold text-foreground">Library</h1>

      <LibraryToolbar
        q={state.q}
        onQChange={(q) => pushState({ ...state, q }, group)}
        sort={state.sort}
        onSortChange={(sort) => pushState({ ...state, sort }, group)}
        group={group}
        onGroupChange={(nextGroup) => pushState(state, nextGroup)}
        activeFilterCount={countActiveFilters(state.filters)}
        onOpenFilters={() => setFilterSheetOpen(true)}
        isSearching={isSearching}
      />

      <ActiveFilterChips
        filters={state.filters}
        topics={topics}
        onChange={(filters) => pushState({ ...state, filters }, group)}
      />

      <FilterSheet
        open={filterSheetOpen}
        onOpenChange={setFilterSheetOpen}
        filters={state.filters}
        onApply={(filters) => pushState({ ...state, filters }, group)}
        topicOptions={topics}
        tagOptions={tags}
      />

      <LibraryGrid
        items={items}
        group={group}
        isPending={isPending}
        isError={isError}
        isSearching={isSearching}
        isRefiningSearch={isRefiningSearch}
        hasActiveFilters={hasActiveFilters}
        q={state.q}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={fetchNextPage}
        onRetry={refetch}
        onClearFilters={() => pushState({ ...state, filters: { ...EMPTY_FILTERS } }, group)}
        onClearSearch={() =>
          pushState({ ...emptyLibraryQueryState(), filters: state.filters }, group)
        }
      />
    </div>
  )
}

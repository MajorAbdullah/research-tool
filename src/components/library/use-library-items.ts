'use client'

import { useMemo } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { fetchItemsPage, fetchSearchPage } from '@/components/library/api-client'
import { pickSearchItems } from '@/components/library/pick-search-items'
import { libraryQueryKey, toApiSearchParams } from '@/components/library/query-params'
import type {
  ItemSummary,
  LibraryQueryState,
  SearchResultSummary,
  WirePage,
} from '@/components/library/types'

const PAGE_SIZE = 24

/** What the grid renders — an `ItemSummary` plus an optional search snippet (present only in search mode, and nullable — see `SearchResultSummary.snippet`'s comment). */
export type LibraryListItem = ItemSummary & { snippet?: string | null }

export interface UseLibraryItemsOptions {
  state: LibraryQueryState
  /**
   * Server-rendered first page for the URL state the page was requested with — whichever of
   * browse/search the Server Component actually fetched (`page.tsx` decides based on `state.q`
   * at request time). Seeds whichever client query matches the CURRENT mode so first paint never
   * shows a spinner for the common "just landed on this URL" case, including a shared/bookmarked
   * search URL — only used when `initialQueryKey` still matches the live params (i.e., nothing
   * has changed client-side since hydration).
   */
  initialPage?: WirePage<LibraryListItem> | null
  initialQueryKey?: string
}

export interface UseLibraryItemsResult {
  items: readonly LibraryListItem[]
  isSearching: boolean
  /** True while showing the fast FTS-only tier because the fused hybrid result hasn't landed yet (deliverable #2). */
  isRefiningSearch: boolean
  isPending: boolean
  isError: boolean
  error: unknown
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  refetch: () => void
}

/**
 * The single data source for the library grid, covering both modes deliverable #1-#2 describe:
 *
 *  - Browse (`state.q` empty): one cursor-paginated `GET /api/v1/items`.
 *  - Search (`state.q` set): TWO queries in flight — a one-shot `tier=fts` request for instant
 *    feedback, and the paginated, authoritative `tier=hybrid` (fused) request. `pickSearchItems`
 *    decides which one is currently on screen; `isRefiningSearch` tells the toolbar to show a
 *    subtle "refining…" indicator rather than a jarring content swap. Pagination past the first
 *    page always continues the hybrid query — the FTS tier exists purely for the first paint's
 *    latency, not for depth (see pick-search-items.ts's header comment).
 *
 * Grouping (deliverable #4) deliberately has no presence here — it's a pure display-layer
 * concern applied to whatever flat `items` this hook returns (see group-items.ts), never a fetch
 * parameter, matching docs/API.md §3.3's "the server doesn't have a separate grouped shape."
 */
export function useLibraryItems({
  state,
  initialPage,
  initialQueryKey,
}: UseLibraryItemsOptions): UseLibraryItemsResult {
  const isSearchMode = state.q.length > 0
  const apiParams = useMemo(() => toApiSearchParams(state), [state])
  const paramsKey = useMemo(() => libraryQueryKey(state), [state])
  const seedMatchesCurrentParams = Boolean(initialPage && initialQueryKey === paramsKey)

  const browseQuery = useInfiniteQuery({
    queryKey: ['library', 'browse', paramsKey],
    queryFn: ({ pageParam }) => fetchItemsPage(apiParams, { cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.has_more ? (last.page.next_cursor ?? undefined) : undefined,
    initialData:
      !isSearchMode && seedMatchesCurrentParams
        ? { pages: [initialPage as WirePage<ItemSummary>], pageParams: [undefined] }
        : undefined,
    enabled: !isSearchMode,
  })

  const ftsQuery = useQuery({
    queryKey: ['library', 'search-fts', paramsKey],
    queryFn: () => fetchSearchPage(apiParams, { tier: 'fts', limit: PAGE_SIZE }),
    enabled: isSearchMode,
  })

  const hybridQuery = useInfiniteQuery({
    queryKey: ['library', 'search-hybrid', paramsKey],
    queryFn: ({ pageParam }) =>
      fetchSearchPage(apiParams, { tier: 'hybrid', cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.has_more ? (last.page.next_cursor ?? undefined) : undefined,
    // Only meaningful for a fresh page load of a shared/bookmarked `?q=...` URL — a client-side
    // search (typed in after mount) always starts with no seed and shows the fts->hybrid handoff.
    initialData:
      isSearchMode && seedMatchesCurrentParams
        ? { pages: [initialPage as WirePage<SearchResultSummary>], pageParams: [undefined] }
        : undefined,
    enabled: isSearchMode,
  })

  const items = useMemo<readonly LibraryListItem[]>(() => {
    if (!isSearchMode) {
      return browseQuery.data?.pages.flatMap((p) => p.data) ?? []
    }
    const ftsItems = ftsQuery.data?.data ?? []
    const hybridItems = hybridQuery.data?.pages.flatMap((p) => p.data) ?? []
    return pickSearchItems(ftsItems, hybridItems, hybridQuery.status === 'success')
  }, [isSearchMode, browseQuery.data, ftsQuery.data, hybridQuery.data, hybridQuery.status])

  const hasAnyData = isSearchMode
    ? ftsQuery.data !== undefined || hybridQuery.data !== undefined
    : browseQuery.data !== undefined

  const isPending = isSearchMode
    ? ftsQuery.isPending && hybridQuery.isPending
    : browseQuery.isPending

  const isError = isSearchMode
    ? !hasAnyData && ftsQuery.isError && hybridQuery.isError
    : !hasAnyData && browseQuery.isError

  const isRefiningSearch = isSearchMode && ftsQuery.isSuccess && hybridQuery.status !== 'success'

  return {
    items,
    isSearching: isSearchMode,
    isRefiningSearch,
    isPending,
    isError,
    error: isSearchMode ? (hybridQuery.error ?? ftsQuery.error) : browseQuery.error,
    hasNextPage: Boolean(isSearchMode ? hybridQuery.hasNextPage : browseQuery.hasNextPage),
    isFetchingNextPage: isSearchMode
      ? hybridQuery.isFetchingNextPage
      : browseQuery.isFetchingNextPage,
    fetchNextPage: () => {
      void (isSearchMode ? hybridQuery.fetchNextPage() : browseQuery.fetchNextPage())
    },
    refetch: () => {
      if (isSearchMode) {
        void ftsQuery.refetch()
        void hybridQuery.refetch()
      } else {
        void browseQuery.refetch()
      }
    },
  }
}

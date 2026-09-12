'use client'

import { Download, LoaderCircle, Search, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ItemCard } from '@/components/common/item-card'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { LoadingGrid } from '@/components/common/loading-grid'
import { groupItems } from '@/components/library/group-items'
import { useInfiniteScrollSentinel } from '@/components/library/use-infinite-scroll-sentinel'
import type { LibraryListItem } from '@/components/library/use-library-items'
import type { GroupBy } from '@/components/library/types'

const GRID_CLASS = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

function ItemCardWithSnippet({ item }: { item: LibraryListItem }) {
  return (
    <div>
      <ItemCard item={item} href={`/items/${item.id}`} />
      {item.snippet && (
        <p className="mt-1.5 line-clamp-2 px-0.5 text-xs text-muted-foreground">{item.snippet}</p>
      )}
    </div>
  )
}

export interface LibraryGridProps {
  items: readonly LibraryListItem[]
  group: GroupBy
  isPending: boolean
  isError: boolean
  isSearching: boolean
  isRefiningSearch: boolean
  hasActiveFilters: boolean
  q: string
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  onRetry: () => void
  onClearFilters: () => void
  onClearSearch: () => void
}

/**
 * The grid itself: every explicitly-designed state (empty, no-results, loading, error — P5's
 * hard requirement) plus grouped/flat rendering and infinite scroll. Grouping is purely which of
 * two render branches runs below — the data (`items`) is identical either way (see
 * use-library-items.ts's header comment).
 */
export function LibraryGrid({
  items,
  group,
  isPending,
  isError,
  isSearching,
  isRefiningSearch,
  hasActiveFilters,
  q,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  onRetry,
  onClearFilters,
  onClearSearch,
}: LibraryGridProps) {
  const sentinelRef = useInfiniteScrollSentinel(fetchNextPage, hasNextPage && !isFetchingNextPage)

  if (isPending) {
    return <LoadingGrid count={8} />
  }

  if (isError) {
    return (
      <ErrorState
        title="Couldn't load your library"
        description="The request failed. Nothing was lost — your items are still saved."
        action={
          <Button size="sm" variant="outline" onClick={onRetry}>
            <TriangleAlert className="size-4" aria-hidden="true" />
            Try again
          </Button>
        }
      />
    )
  }

  if (items.length === 0) {
    if (isSearching) {
      return (
        <EmptyState
          icon={Search}
          title={`No results for "${q}"`}
          description="Try a broader term, or check the filters in the rail."
          action={
            hasActiveFilters ? (
              <Button size="sm" variant="outline" onClick={onClearFilters}>
                Clear filters
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={onClearSearch}>
                Clear search
              </Button>
            )
          }
        />
      )
    }
    if (hasActiveFilters) {
      return (
        <EmptyState
          icon={Search}
          title="No items match these filters"
          description="Try removing one or more filters in the rail."
          action={
            <Button size="sm" variant="outline" onClick={onClearFilters}>
              Clear filters
            </Button>
          }
        />
      )
    }
    return (
      <EmptyState
        icon={Download}
        title="Nothing saved yet"
        description="Share a link from the extension, the Android share sheet, or paste one in to get started."
        action={
          <a
            href="/capture"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Paste a link
          </a>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      {isRefiningSearch && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          Refining results…
        </p>
      )}

      {group === 'none' ? (
        <div className={GRID_CLASS}>
          {items.map((item) => (
            <ItemCardWithSnippet key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {groupItems(items, group).map((section) => (
            <section key={section.key} aria-labelledby={`group-${section.key}`}>
              <h2
                id={`group-${section.key}`}
                className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"
              >
                {section.label}
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {section.items.length}
                </span>
              </h2>
              <div className={GRID_CLASS}>
                {section.items.map((item) => (
                  <ItemCardWithSnippet key={item.id} item={item} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <div ref={sentinelRef} aria-hidden="true" className="h-1" />

      {isFetchingNextPage && (
        <div className={GRID_CLASS} aria-label="Loading more items" role="status">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="animate-pulse rounded-lg border border-border bg-card p-3">
              <div className="aspect-video w-full rounded-md bg-muted" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

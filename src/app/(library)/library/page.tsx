/**
 * `/library` — the browse/search surface (plan §10.1). Server Component: fetches the FIRST page
 * of whatever the incoming URL asks for (browse or search) directly through the service/search
 * layer — not a self-HTTP-fetch back into this app's own API routes, which would need manual
 * cookie-forwarding for no benefit — so the page has real content on first paint. Every
 * subsequent interaction (typing, filtering, sorting, grouping, infinite scroll) is handled
 * client-side by `LibraryView`, which re-fetches through the actual versioned HTTP API
 * (`src/components/library/api-client.ts`) exactly as any other caller of this API would.
 */

import type { Metadata } from 'next'
import { LibraryQueryProvider } from '@/components/library/query-provider'
import { LibraryView } from '@/components/library/library-view'
import { parseLibraryQueryState, toApiSearchParams } from '@/components/library/query-params'
import type { ItemSummary, SearchResultSummary, WirePage } from '@/components/library/types'
import { requireSessionUserIdOrRedirect } from '@/services/auth-context'
import { listItems } from '@/services/items-service'
import { parseItemsListQuery } from '@/services/items-schema'
import { hybridSearch, parseSearchQuery, type SearchResultItem } from '@/lib/search'
import { getLocalEmbeddingProvider } from '@/lib/embeddings'
import { getSqlite } from '@/db/client'
import { logger } from '@/lib/logger'

export const metadata: Metadata = {
  title: 'Library · Sieve',
}

interface LibraryPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function toURLSearchParams(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, entry)
    } else {
      params.set(key, value)
    }
  }
  return params
}

/**
 * `SearchResultItem.extraction_tier`/`.snippet` are typed nullable at the search layer (see
 * `library/types.ts`'s comment on `SearchResultSummary.snippet`) even though every field except
 * these two is guaranteed present. A missing tier defensively reads as the most conservative
 * value — "metadata only" — rather than silently widening this phase's `ItemSummary.extraction_tier`
 * (shared with the browse path, where `ItemSummaryWire` guarantees non-null) to accept `null`
 * everywhere just to accommodate this one path.
 */
function toSearchResultSummary(item: SearchResultItem): SearchResultSummary {
  return { ...item, extraction_tier: item.extraction_tier ?? 'metadata_only' }
}

async function fetchInitialPage(
  userId: number,
  state: ReturnType<typeof parseLibraryQueryState>,
  apiParams: URLSearchParams,
): Promise<WirePage<ItemSummary> | WirePage<SearchResultSummary>> {
  if (state.q) {
    const parsed = parseSearchQuery(apiParams)
    const result = await hybridSearch(getSqlite(), getLocalEmbeddingProvider(), {
      userId,
      query: parsed.q,
      filters: parsed.filters,
      cursor: parsed.cursor,
      limit: parsed.limit,
    })
    return { data: result.data.map(toSearchResultSummary), page: result.page }
  }

  const query = parseItemsListQuery(apiParams)
  return listItems(userId, query)
}

export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  const rawParams = toURLSearchParams(await searchParams)
  const state = parseLibraryQueryState(rawParams)
  const apiParams = toApiSearchParams(state)
  const initialQueryKey = apiParams.toString()

  // OUTSIDE the try/catch below, deliberately. Next's `redirect()` works by THROWING a special
  // error, so a surrounding catch swallows it — which is what happened here: an unauthenticated
  // visitor got a 200 with an empty library instead of the login page, and the swallowed redirect
  // was logged as "server-side initial fetch failed". Auth must resolve before the guard exists.
  const userId = await requireSessionUserIdOrRedirect()

  let initialPage: WirePage<ItemSummary> | WirePage<SearchResultSummary> | null = null
  try {
    initialPage = await fetchInitialPage(userId, state, apiParams)
  } catch (err) {
    // Never crash the page for a first-paint hiccup — LibraryView's client-side fetch (the exact
    // same versioned HTTP API any other caller uses) takes over and renders its own loading/error
    // state. See this phase's final report.
    logger.error(
      { err },
      'library page: server-side initial fetch failed, deferring to client fetch',
    )
    initialPage = null
  }

  return (
    <LibraryQueryProvider>
      <LibraryView initialPage={initialPage} initialQueryKey={initialQueryKey} />
    </LibraryQueryProvider>
  )
}

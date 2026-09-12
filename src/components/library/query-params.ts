/**
 * URL <-> library state, in both directions. Pure functions, no React/DOM — the whole point is
 * that filters (deliverable #3) and the group-by choice (deliverable #4) round-trip through a
 * plain `URLSearchParams`/query-string object so a filtered, grouped view is shareable and
 * bookmarkable, per the phase brief. Parsing is deliberately permissive (garbage/unknown values
 * are dropped, never thrown) — a hand-edited or stale URL should degrade to "ignore what doesn't
 * parse," not break the page.
 *
 * Query-param *names* match `docs/API.md` §3.2/§3.3 exactly (`kind`, `topic`, `tag`, `status`,
 * `extraction_tier`, `date_from`, `date_to`, `sort`, `q`) so the same URL search string a client
 * builds for navigation can be reused, close to verbatim, as the fetch query string — see
 * `toApiSearchParams`. `group` is this layer's one addition; the API has no concept of it
 * (grouping is a client-side view, docs/API.md §3.3).
 */

import type {
  ExtractionTier,
  GroupBy,
  ItemKind,
  ItemStatus,
  LibraryFilters,
  LibraryQueryState,
  LibrarySortMode,
} from '@/components/library/types'
import { EMPTY_FILTERS } from '@/components/library/types'

// Exported — filter-rail.tsx renders one checkbox per value, and reuses these exact lists rather
// than redeclaring a second copy that could drift from what this module actually validates.
export const ITEM_KIND_VALUES: readonly ItemKind[] = [
  'github',
  'video',
  'article',
  'social',
  'pdf',
  'audio',
  'other',
]
export const ITEM_STATUS_VALUES: readonly ItemStatus[] = [
  'queued',
  'processing',
  'inbox',
  'to_test',
  'testing',
  'tested',
  'archived',
  'dropped',
  'failed',
]
export const EXTRACTION_TIER_VALUES: readonly ExtractionTier[] = [
  'full',
  'partial',
  'metadata_only',
]
const SORT_VALUES: readonly LibrarySortMode[] = ['newest', 'oldest', 'recently_opened']
const GROUP_VALUES: readonly GroupBy[] = ['none', 'kind', 'topic', 'status', 'date']

const DEFAULT_SORT: LibrarySortMode = 'newest'
const DEFAULT_GROUP: GroupBy = 'none'

function parseCsvEnum<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return []
  const set = new Set<string>(allowed)
  const seen = new Set<T>()
  for (const part of raw.split(',')) {
    const value = part.trim()
    if (value && set.has(value) && !seen.has(value as T)) seen.add(value as T)
  }
  return [...seen]
}

/** Free-text CSV (topic slugs, tag labels) — no enum to validate against, just trim/dedupe/drop-empty. */
function parseCsvFree(raw: string | null): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  for (const part of raw.split(',')) {
    const value = part.trim()
    if (value) seen.add(value)
  }
  return [...seen]
}

function parseEpochMs(raw: string | null): number | undefined {
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

function parseEnum<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
}

export function parseLibraryFilters(searchParams: URLSearchParams): LibraryFilters {
  return {
    kind: parseCsvEnum(searchParams.get('kind'), ITEM_KIND_VALUES),
    topic: parseCsvFree(searchParams.get('topic')),
    tag: parseCsvFree(searchParams.get('tag')),
    status: parseCsvEnum(searchParams.get('status'), ITEM_STATUS_VALUES),
    extractionTier: parseCsvEnum(searchParams.get('extraction_tier'), EXTRACTION_TIER_VALUES),
    dateFrom: parseEpochMs(searchParams.get('date_from')),
    dateTo: parseEpochMs(searchParams.get('date_to')),
  }
}

export function parseLibraryQueryState(searchParams: URLSearchParams): LibraryQueryState {
  return {
    q: (searchParams.get('q') ?? '').trim(),
    filters: parseLibraryFilters(searchParams),
    sort: parseEnum(searchParams.get('sort'), SORT_VALUES, DEFAULT_SORT),
  }
}

export function parseGroupBy(searchParams: URLSearchParams): GroupBy {
  return parseEnum(searchParams.get('group'), GROUP_VALUES, DEFAULT_GROUP)
}

/**
 * State -> a minimal `URLSearchParams` (default values omitted entirely, so a plain unfiltered
 * "newest, ungrouped" view is just `/library` with no query string, not `/library?sort=newest`).
 * Used both to push a new URL from the client and — via `toApiSearchParams` below — to build the
 * fetch query string.
 */
export function serializeLibraryState(
  state: LibraryQueryState,
  group: GroupBy = DEFAULT_GROUP,
): URLSearchParams {
  const params = new URLSearchParams()
  if (state.q) params.set('q', state.q)
  if (state.filters.kind.length) params.set('kind', state.filters.kind.join(','))
  if (state.filters.topic.length) params.set('topic', state.filters.topic.join(','))
  if (state.filters.tag.length) params.set('tag', state.filters.tag.join(','))
  if (state.filters.status.length) params.set('status', state.filters.status.join(','))
  if (state.filters.extractionTier.length)
    params.set('extraction_tier', state.filters.extractionTier.join(','))
  if (state.filters.dateFrom !== undefined) params.set('date_from', String(state.filters.dateFrom))
  if (state.filters.dateTo !== undefined) params.set('date_to', String(state.filters.dateTo))
  if (state.sort !== DEFAULT_SORT) params.set('sort', state.sort)
  if (group !== DEFAULT_GROUP) params.set('group', group)
  return params
}

/**
 * State -> the query string sent to `GET /api/v1/items` or `GET /api/v1/search`. Same param names
 * as the URL (by design, per file header) minus `group` (API has no such param) and with `sort`
 * always written explicitly (the API defaults to `newest` too, but being explicit here means this
 * function's output never depends on a coincidence between this layer's default and the API's).
 * `q` is included when non-empty and dropped otherwise — callers in browse mode never set it in
 * the first place, and `/api/v1/search`'s parser only reads params it explicitly names (see
 * `src/lib/search/query-schema.ts`), so an extra `sort` present when calling search is simply
 * ignored there rather than rejected. `tier`/`cursor`/`limit` are call-site concerns
 * (api-client.ts), not part of persisted state.
 */
export function toApiSearchParams(state: LibraryQueryState): URLSearchParams {
  const params = serializeLibraryState(state, DEFAULT_GROUP)
  if (!params.has('sort')) params.set('sort', state.sort)
  return params
}

export function isFiltersEmpty(filters: LibraryFilters): boolean {
  return (
    filters.kind.length === 0 &&
    filters.topic.length === 0 &&
    filters.tag.length === 0 &&
    filters.status.length === 0 &&
    filters.extractionTier.length === 0 &&
    filters.dateFrom === undefined &&
    filters.dateTo === undefined
  )
}

export function countActiveFilters(filters: LibraryFilters): number {
  let count =
    filters.kind.length +
    filters.topic.length +
    filters.tag.length +
    filters.status.length +
    filters.extractionTier.length
  if (filters.dateFrom !== undefined || filters.dateTo !== undefined) count += 1
  return count
}

export function emptyLibraryQueryState(): LibraryQueryState {
  return { q: '', filters: { ...EMPTY_FILTERS }, sort: DEFAULT_SORT }
}

/** A stable string key for a `LibraryQueryState`, suitable as (part of) a TanStack Query key. */
export function libraryQueryKey(state: LibraryQueryState): string {
  return toApiSearchParams(state).toString()
}

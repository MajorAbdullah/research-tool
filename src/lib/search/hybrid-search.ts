/**
 * Orchestrates hybrid search: FTS5 + vector search, fused with RRF, hydrated to
 * `ItemSummary`-shaped results, and cursor-paginated. This is what `GET /api/v1/search` (§3.2)
 * delegates to.
 *
 * Two entry points share all of this machinery:
 *   - `hybridSearch` — the fused result (needs `embedQuery`, so it's async).
 *   - `ftsOnlySearch` — the instant, keyword-only tier for search-as-you-type (deliverable #6):
 *     no embedding wait, same response shape, so a client can render this immediately and swap in
 *     the fused result once it resolves without changing how it renders either page.
 */

import type Database from 'better-sqlite3'
import type { EmbeddingProvider } from '@/types/contracts'
import { ftsSearch, ftsSnippet } from './fts-search'
import { vectorSearch, type VectorSearchHit } from './vector-search'
import { reciprocalRankFusion, DEFAULT_RRF_K, type FusedResult } from './rrf'
import { loadItemSummaryRows, type SearchResultItem } from './item-summary'
import { decodeSearchCursor, encodeSearchCursor, paginateFused } from './pagination'
import type { SearchFilters } from './filters'

/** Candidates fed into RRF from EACH ranking before fusion — not the page size. Wide enough that
 *  a 20-result page rarely needs a second widening pass, bounded so latency stays predictable
 *  regardless of corpus size (docs/API.md §3.2: p95 < 300ms at 5k items). */
export const DEFAULT_CANDIDATE_POOL_SIZE = 200
export const DEFAULT_PAGE_LIMIT = 20
export const MAX_PAGE_LIMIT = 100
const SNIPPET_FALLBACK_LENGTH = 220

export interface HybridSearchOptions {
  userId: number
  query: string
  filters?: SearchFilters
  cursor?: string
  limit?: number
  candidatePoolSize?: number
}

export interface SearchPage {
  data: SearchResultItem[]
  page: { next_cursor: string | null; has_more: boolean }
}

/** docs/API.md §1.6: values outside 1..100 are CLAMPED, not rejected. */
export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) return DEFAULT_PAGE_LIMIT
  return Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.trunc(limit)))
}

function buildChunkSnippet(sqlite: Database.Database, chunkId: number): string | null {
  const row = sqlite.prepare('SELECT text FROM chunks WHERE id = ?').get(chunkId) as
    { text: string } | undefined
  if (!row) return null
  const text = row.text.trim()
  if (text.length <= SNIPPET_FALLBACK_LENGTH) return text
  return `${text.slice(0, SNIPPET_FALLBACK_LENGTH).trim()}…`
}

function assemblePage(
  sqlite: Database.Database,
  options: HybridSearchOptions & { limit: number },
  fused: FusedResult[],
  vectorHitsByItem: ReadonlyMap<number, VectorSearchHit>,
): SearchPage {
  const decodedCursor = decodeSearchCursor(options.cursor)
  const { page, hasMore } = paginateFused(fused, decodedCursor, options.limit)

  const rows = loadItemSummaryRows(
    sqlite,
    page.map((hit) => hit.id),
    options.userId,
  )

  const data: SearchResultItem[] = []
  for (const hit of page) {
    const base = rows.get(hit.id)
    // Item vanished between ranking and hydration (e.g. a concurrent delete) — skip it rather
    // than crash; the next page's cursor math is unaffected since it's anchored to (score, id).
    if (!base) continue

    const usedFts = hit.ranks.fts !== undefined
    let snippet: string | null = null
    if (usedFts) {
      snippet = ftsSnippet(sqlite, hit.id, options.query)
    }
    if (snippet === null) {
      const vectorHit = vectorHitsByItem.get(hit.id)
      snippet = vectorHit ? buildChunkSnippet(sqlite, vectorHit.bestChunkId) : null
    }

    data.push({ ...base, snippet, score: hit.score })
  }

  const last = page[page.length - 1]
  const nextCursor = hasMore && last ? encodeSearchCursor({ score: last.score, id: last.id }) : null
  return { data, page: { next_cursor: nextCursor, has_more: hasMore } }
}

export async function hybridSearch(
  sqlite: Database.Database,
  embeddingProvider: EmbeddingProvider,
  options: HybridSearchOptions,
): Promise<SearchPage> {
  const limit = clampLimit(options.limit)
  const poolSize = options.candidatePoolSize ?? DEFAULT_CANDIDATE_POOL_SIZE

  const ftsHits = ftsSearch(sqlite, {
    userId: options.userId,
    query: options.query,
    limit: poolSize,
    filters: options.filters,
  })

  // embedQuery(), never embed() — BGE's instruction prefix is query-side only; see
  // contracts.ts's `EmbeddingProvider.embedQuery` doc and `@/lib/embeddings`'s file header.
  const queryEmbedding = await embeddingProvider.embedQuery(options.query)
  const vectorHits = vectorSearch(sqlite, {
    userId: options.userId,
    queryEmbedding,
    limit: poolSize,
    filters: options.filters,
  })

  const fused = reciprocalRankFusion(
    { fts: ftsHits.map((h) => h.itemId), vector: vectorHits.map((h) => h.itemId) },
    DEFAULT_RRF_K,
  )
  const vectorHitsByItem = new Map(vectorHits.map((h) => [h.itemId, h]))
  return assemblePage(sqlite, { ...options, limit }, fused, vectorHitsByItem)
}

/** The instant, keyword-only tier for search-as-you-type — see file header. */
export function ftsOnlySearch(sqlite: Database.Database, options: HybridSearchOptions): SearchPage {
  const limit = clampLimit(options.limit)
  const poolSize = options.candidatePoolSize ?? DEFAULT_CANDIDATE_POOL_SIZE

  const ftsHits = ftsSearch(sqlite, {
    userId: options.userId,
    query: options.query,
    limit: poolSize,
    filters: options.filters,
  })
  const fused = reciprocalRankFusion({ fts: ftsHits.map((h) => h.itemId) }, DEFAULT_RRF_K)
  return assemblePage(sqlite, { ...options, limit }, fused, new Map())
}

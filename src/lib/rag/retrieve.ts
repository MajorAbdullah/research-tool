/**
 * Retrieval: the one seam in this phase that touches the database and the search layer. Delegates
 * every ranking decision to `@/lib/search`'s `hybridSearch()` (P9, tested, frozen) — this module
 * never re-derives FTS/vector fusion itself. Its own job is strictly downstream of that: hydrate
 * the winning items' chunk text (context assembly needs real content, not the short preview
 * snippet `hybridSearch()` returns for the library search page), and read the two retrievers' raw,
 * per-item signals for the groundedness gate (see `groundedness.ts` for why the fused `score`
 * alone can't drive that decision).
 */

import type Database from 'better-sqlite3'
import type { EmbeddingProvider } from '@/types/contracts'
import { hybridSearch, ftsSearch, vectorSearch, type SearchFilters } from '@/lib/search'
import { isPreGenerationGrounded } from './groundedness'
import { parseItemWireId } from './ids'
import type { CandidateChunk, CandidateItem, ChatFilters, RetrieveRawResult } from './types'

/** Distinct ITEMS considered — not a page size; a chat answer synthesizes across a handful of
 *  sources, never dozens (rag-best-practices §4: "keep retrieved context relevant and minimal"). */
export const DEFAULT_MAX_ITEMS = 6
/** Per-item chunk cap, applied before the token budget even sees them — bounds one very long
 *  transcript from crowding out every other source on its own. */
export const DEFAULT_MAX_CHUNKS_PER_ITEM = 8

export interface RetrieveDeps {
  sqlite: Database.Database
  embeddingProvider: EmbeddingProvider
}

export interface RetrieveOptions {
  userId: number
  query: string
  filters?: ChatFilters
  maxItems?: number
  maxChunksPerItem?: number
}

function toSearchFilters(filters: ChatFilters | undefined): SearchFilters | undefined {
  if (!filters || (!filters.kind && !filters.topic)) return undefined
  return {
    kind: filters.kind ? [filters.kind] : undefined,
    topic: filters.topic ? [filters.topic] : undefined,
  }
}

interface ChunkRow {
  id: number
  ord: number
  text: string
}

function loadChunks(
  sqlite: Database.Database,
  itemId: number,
  userId: number,
  limit: number,
): ChunkRow[] {
  return sqlite
    .prepare(
      `SELECT id, ord, text FROM chunks WHERE item_id = ? AND user_id = ? ORDER BY ord ASC LIMIT ?`,
    )
    .all(itemId, userId, limit) as ChunkRow[]
}

/**
 * Runs retrieval for one chat turn. Always calls `hybridSearch()` for the actual ranking; the
 * extra direct `ftsSearch()`/`vectorSearch()` calls alongside it read raw, per-item signals
 * (bm25 rank, L2 distance) that `hybridSearch()`'s public `SearchResultItem` shape doesn't expose
 * — used only by the groundedness gate below, never to re-rank or re-select anything.
 */
export async function retrieveCandidates(
  deps: RetrieveDeps,
  options: RetrieveOptions,
): Promise<RetrieveRawResult> {
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS
  const maxChunksPerItem = options.maxChunksPerItem ?? DEFAULT_MAX_CHUNKS_PER_ITEM
  const searchFilters = toSearchFilters(options.filters)

  const page = await hybridSearch(deps.sqlite, deps.embeddingProvider, {
    userId: options.userId,
    query: options.query,
    filters: searchFilters,
    limit: maxItems,
  })

  const [queryEmbedding, ftsHits] = await Promise.all([
    deps.embeddingProvider.embedQuery(options.query),
    Promise.resolve(
      ftsSearch(deps.sqlite, {
        userId: options.userId,
        query: options.query,
        limit: maxItems,
        filters: searchFilters,
      }),
    ),
  ])
  const vectorHits = vectorSearch(deps.sqlite, {
    userId: options.userId,
    queryEmbedding,
    limit: maxItems,
    filters: searchFilters,
  })

  const ftsRankByItem = new Map(ftsHits.map((h) => [h.itemId, h.rank]))
  const vectorDistanceByItem = new Map(vectorHits.map((h) => [h.itemId, h.distance]))
  const bestVectorDistance = vectorHits.reduce<number | null>(
    (min, hit) => (min === null || hit.distance < min ? hit.distance : min),
    null,
  )

  const groundedPreGate = isPreGenerationGrounded({
    itemCount: page.data.length,
    hasAnyFtsHit: ftsHits.length > 0,
    bestVectorDistance,
  })

  if (page.data.length === 0) {
    return { items: [], groundedPreGate }
  }

  const items: CandidateItem[] = []
  for (const result of page.data) {
    const itemId = parseItemWireId(result.id)
    if (itemId === null) continue // defensive only — see ids.ts

    const rows = loadChunks(deps.sqlite, itemId, options.userId, maxChunksPerItem)
    const chunks: CandidateChunk[] = rows.map((row) => ({
      chunkId: row.id,
      ord: row.ord,
      text: row.text,
      ftsRank: ftsRankByItem.get(itemId) ?? null,
      vectorDistance: vectorDistanceByItem.get(itemId) ?? null,
    }))
    // An item with zero chunks (e.g. embed job hasn't run yet) contributes nothing to context —
    // skip it rather than emit a citation with an empty body.
    if (chunks.length === 0) continue

    items.push({
      itemId,
      wireId: result.id,
      title: result.title,
      kind: result.kind,
      canonicalUrl: result.canonical_url,
      fusedScore: result.score,
      chunks,
    })
  }

  return { items, groundedPreGate }
}

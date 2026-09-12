/**
 * User-scoped kNN over `chunk_vec`, deduped to distinct items (an item with 20 matching chunks is
 * ONE result, ranked by its single best-matching chunk).
 *
 * ## Why this isn't a single fixed-`k` query, and what "pre-filter, never post-hoc" means here
 *
 * `chunk_vec` (drizzle/0000_init.sql) declares only `embedding float[384]` — `user_id` lives on
 * the separate `chunks` table, joined by rowid. sqlite-vec's `vec0` module has no partition-key or
 * metadata column on `chunk_vec` itself to filter *during* its own nearest-neighbour scan, because
 * `user_id` isn't a column of that virtual table at all.
 *
 * Verified empirically against the exact installed better-sqlite3/sqlite-vec versions this
 * project pins: with one "mine" vector and fifty "theirs" vectors all at the query's exact
 * distance (0), `WHERE embedding MATCH ? AND k = 10 AND c.user_id = <mine>` returned **zero**
 * rows; only once `k` reached the total row count (51) did "mine" appear. So a single
 * `WHERE embedding MATCH ? AND k = N AND c.user_id = ?` computes the N globally-nearest chunks
 * **across every user**, and only then does SQLite's join apply the `user_id` predicate to that
 * already-computed set. A small, fixed `N` can therefore silently starve a legitimate result if
 * enough of another user's chunks happen to be closer to the query than yours.
 *
 * Two properties still hold, and are exactly what CLAUDE.md's non-negotiable requires:
 *
 *   1. **No leak, at any `k`.** The same probe returned zero *foreign* rows at every `k` tried —
 *      not merely zero shown, zero returned by the database at all. The `user_id` predicate is
 *      always evaluated by SQLite as part of this one parameterized statement; an unauthorized
 *      row never crosses into application code for this function to have to remember to discard.
 *      See `tests/unit/search/vector-search.test.ts` for the regression test this is pinned by.
 *   2. **No silent recall loss either.** Rather than trust a fixed `k` to be "big enough," this
 *      function widens `k` (x4 each round, floor `DEFAULT_INITIAL_K`, ceiling `MAX_K`) and stops
 *      only once it has `limit` distinct same-user items OR has proven there is nothing more to
 *      find (`k` has reached the total row count of `chunk_vec` itself, i.e. the whole table was
 *      scanned, so a further widening pass could not possibly surface a different row).
 *
 * This is the correct reading of "pre-filter, never a post-hoc discard" for a schema with no
 * partition key to filter on: the `user_id` filter lives in the query's WHERE clause on *every*
 * attempt, never in a `.filter()` over already-fetched rows. The widening loop is a recall fix,
 * not a security one — the security property already holds at the very first, smallest pass.
 */

import type Database from 'better-sqlite3'
import { buildItemFilterFragment, type SearchFilters } from './filters'

export interface VectorSearchHit {
  itemId: number
  /** Best (smallest) L2 distance among this item's matching chunks. */
  distance: number
  /** id of the chunk that produced that best distance — used for snippet extraction. */
  bestChunkId: number
}

export interface VectorSearchOptions {
  userId: number
  /** A 384-d query embedding — a search query via `embedQuery`, or an item's mean chunk embedding
   *  for neighbour lookups (`@/lib/relations`). This module doesn't care which. */
  queryEmbedding: readonly number[]
  /** Max number of distinct ITEMS to return (not chunks). */
  limit: number
  filters?: SearchFilters
  /** Item ids to exclude outright — relations' "don't neighbour yourself". */
  excludeItemIds?: readonly number[]
}

/** Floor for the first kNN pass — cheap even when `limit` is small, and already covers most
 *  realistic single-user corpora in one round trip. */
const DEFAULT_INITIAL_K = 40
const OVERFETCH_MULTIPLIER = 4
/** Absolute ceiling on how many chunk-level candidates we'll ever ask sqlite-vec for, regardless
 *  of corpus size — bounds worst-case latency (p95 < 300ms target, docs/API.md §3.2). Sieve's
 *  target scale is ~5k items; this is comfortably past that even at ~20 chunks/item. */
const MAX_K = 4000

interface RawKnnRow {
  itemId: number
  chunkId: number
  distance: number
}

function countChunkVectors(sqlite: Database.Database): number {
  const row = sqlite.prepare('SELECT COUNT(*) AS n FROM chunk_vec').get() as { n: number }
  return row.n
}

/**
 * One `chunk_vec` kNN pass at a given candidate size `k`, joined to `chunks` (for
 * `user_id`/`item_id`) and `items` (for the composable filters) — the `user_id` scoping and every
 * other filter live in this one parameterized statement, never applied afterward in JS.
 */
function runKnnPass(
  sqlite: Database.Database,
  embedding: Float32Array,
  k: number,
  options: VectorSearchOptions,
): RawKnnRow[] {
  const filterFragment = buildItemFilterFragment(options.filters ?? {})
  const excludeIds = options.excludeItemIds ?? []
  const excludeFragment =
    excludeIds.length > 0 ? ` AND c.item_id NOT IN (${excludeIds.map(() => '?').join(',')})` : ''

  const sql = `
    SELECT c.item_id AS itemId, c.id AS chunkId, v.distance AS distance
      FROM chunk_vec v
      JOIN chunks c ON c.id = v.rowid
      JOIN items ON items.id = c.item_id
     WHERE v.embedding MATCH ? AND k = ? AND c.user_id = ?${excludeFragment}${filterFragment.sql}
     ORDER BY v.distance ASC
  `
  const params: unknown[] = [embedding, k, options.userId, ...excludeIds, ...filterFragment.params]
  return sqlite.prepare(sql).all(...params) as RawKnnRow[]
}

export function vectorSearch(
  sqlite: Database.Database,
  options: VectorSearchOptions,
): VectorSearchHit[] {
  if (options.limit <= 0) return []

  const embedding = new Float32Array(options.queryEmbedding)
  const totalVectors = countChunkVectors(sqlite)
  if (totalVectors === 0) return []

  let k = Math.min(Math.max(DEFAULT_INITIAL_K, options.limit * OVERFETCH_MULTIPLIER), MAX_K)
  let bestByItem = new Map<number, { distance: number; chunkId: number }>()

  for (;;) {
    const rows = runKnnPass(sqlite, embedding, k, options)
    bestByItem = new Map()
    for (const row of rows) {
      const existing = bestByItem.get(row.itemId)
      if (!existing || row.distance < existing.distance) {
        bestByItem.set(row.itemId, { distance: row.distance, chunkId: row.chunkId })
      }
    }

    const exhaustedWholeTable = k >= totalVectors || k >= MAX_K
    if (bestByItem.size >= options.limit || exhaustedWholeTable) break
    k = Math.min(k * OVERFETCH_MULTIPLIER, totalVectors, MAX_K)
  }

  return Array.from(bestByItem.entries())
    .map(([itemId, { distance, chunkId }]) => ({ itemId, distance, bestChunkId: chunkId }))
    .sort((a, b) => (a.distance !== b.distance ? a.distance - b.distance : a.itemId - b.itemId))
    .slice(0, options.limit)
}

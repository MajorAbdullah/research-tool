/**
 * Item-level mean embedding + top-K kNN neighbours (P9.2.1).
 *
 * There is no `item_vec`/mean-embedding column or table anywhere in the schema —
 * drizzle/0000_init.sql is fixed (this phase doesn't get to add a migration), so an item's
 * representative vector is always recomputed on demand from its own `chunk_vec` rows rather than
 * persisted. That's cheap: it's a handful of 384-float averages, not a model call.
 */

import type Database from 'better-sqlite3'
import { vectorSearch, type VectorSearchHit } from '@/lib/search/vector-search'

export interface ItemNeighbor {
  itemId: number
  distance: number
}

const DEFAULT_TOP_K = 5

interface ChunkVectorRow {
  vec: string
}

/**
 * Averages an item's own chunk embeddings into one representative vector. Uses sqlite-vec's own
 * `vec_to_json()` to decode the stored vector blob back into plain numbers, rather than
 * hand-parsing the float32 buffer layout — letting the extension that owns the binary format be
 * the one that reads it back (verified empirically against the installed sqlite-vec 0.1.9 to
 * round-trip exactly against a known vector).
 *
 * Returns `null` when the item has no chunks yet — nothing to average, nothing to search with
 * (e.g. an item still waiting on extraction/embedding).
 */
export function computeMeanEmbedding(
  sqlite: Database.Database,
  itemId: number,
  userId: number,
): number[] | null {
  const rows = sqlite
    .prepare(
      `SELECT vec_to_json(v.embedding) AS vec
         FROM chunk_vec v
         JOIN chunks c ON c.id = v.rowid
        WHERE c.item_id = ? AND c.user_id = ?`,
    )
    .all(itemId, userId) as ChunkVectorRow[]

  if (rows.length === 0) return null

  let dimensions = 0
  const sum: number[] = []
  for (const row of rows) {
    const vec = JSON.parse(row.vec) as number[]
    if (dimensions === 0) {
      dimensions = vec.length
      sum.push(...(new Array(dimensions).fill(0) as number[]))
    }
    for (let i = 0; i < dimensions; i++) {
      sum[i] = (sum[i] ?? 0) + (vec[i] ?? 0)
    }
  }
  return sum.map((total) => total / rows.length)
}

export interface FindItemNeighborsOptions {
  itemId: number
  userId: number
  topK?: number
}

/**
 * Top-K nearest OTHER items for `itemId` — the mean of its own chunks' embeddings, searched
 * against every other chunk this user owns via the exact same user-scoped, adaptively-widened kNN
 * as query-time search (`@/lib/search/vector-search`), reused rather than reimplemented: "kNN
 * over `chunk_vec`, scoped by `user_id`, deduped to items" is one behavior, whether the query
 * vector came from a typed search box or from averaging an item's own chunks.
 */
export function findItemNeighbors(
  sqlite: Database.Database,
  options: FindItemNeighborsOptions,
): ItemNeighbor[] {
  const meanEmbedding = computeMeanEmbedding(sqlite, options.itemId, options.userId)
  if (!meanEmbedding) return []

  const hits: VectorSearchHit[] = vectorSearch(sqlite, {
    userId: options.userId,
    queryEmbedding: meanEmbedding,
    limit: options.topK ?? DEFAULT_TOP_K,
    excludeItemIds: [options.itemId],
  })

  return hits.map((hit) => ({ itemId: hit.itemId, distance: hit.distance }))
}

/**
 * Converts a `vec0` L2 distance (unbounded, 0 = identical) into a bounded `(0, 1]` similarity
 * score for `relations.score` (`CHECK(score BETWEEN 0 AND 1)`, drizzle/0000_init.sql) — derived
 * from the actual embedding geometry rather than asked of the labeling LLM as a made-up confidence
 * number, which models are notoriously unreliable at self-rating and which would need its own
 * separate validation anyway.
 *
 * `1 / (1 + distance)` maps `[0, ∞) -> (0, 1]` monotonically (0 distance -> 1.0 "identical";
 * growing distance -> asymptotically 0) without assuming vectors are unit-normalized — unlike, say,
 * `1 - distance/2`, which only holds if L2 distance is known to sit in a fixed `[0, 2]` range.
 */
export function similarityFromDistance(distance: number): number {
  return 1 / (1 + Math.max(0, distance))
}

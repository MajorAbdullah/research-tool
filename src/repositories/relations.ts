/**
 * Relation candidate search + persistence — kNN over `chunk_vec` (P7.5) and writing `relations`
 * rows. TYPE/rationale labeling is a SEPARATE, batched LLM sweep (P9.2.2, ADR 0004: "relation
 * labeling is ~0.05 requests/item, batched" — never per-item): this module makes zero LLM calls.
 * Every relation it writes gets the neutral default type `'similar'` and `rationale: null`; P9's
 * sweep later UPDATEs a subset of these rows to a more specific type + rationale, using the same
 * `(item_a, item_b)` identity, so labeling never creates a duplicate row.
 *
 * `chunk_vec` has no `user_id` column of its own (a bare `vec0` virtual table — see
 * src/db/schema.ts's header on why FTS5/vec0 aren't Drizzle-declared), so CLAUDE.md's "access
 * control filters BEFORE the kNN, never by discarding results after" is satisfied by pre-filtering
 * the *candidate rowid set* via a join back to `chunks.user_id` inside the same MATCH query.
 * Verified empirically against the installed sqlite-vec (0.1.9): `rowid IN (subquery) AND
 * embedding MATCH ? AND k = ?` is recognized as a single optimized kNN query and genuinely
 * excludes non-matching rowids before ranking — a bare inequality like `rowid != ?` alongside
 * `MATCH` is NOT recognized the same way and errors with "A LIMIT or 'k = ?' constraint is
 * required on vec0 knn queries." This exact IN-subquery shape is the one that works.
 */
import { relations as relationsTable } from '@/db/schema'
import type { DbClient } from '@/db/client'
import type { RelationType } from '@/types/contracts'

export interface ChunkNeighbor {
  itemId: number
  /** Best (smallest) L2 distance among this neighbouring item's candidate chunks. */
  distance: number
}

interface RawNeighborRow {
  item_id: number
  distance: number
}

export interface FindNearestItemsParams {
  queryVector: readonly number[]
  userId: number
  /** The item being related — never its own neighbour. */
  excludeItemId: number
  /** How many distinct neighbouring items to return, closest first. */
  topN: number
  /** How many raw chunk_vec rows to pull before de-duplicating to distinct items — needs to be
   *  bigger than `topN` because several of one neighbouring item's own chunks can otherwise crowd
   *  out a genuinely different item from the top of the raw candidate list. */
  fetchK?: number
}

/**
 * kNN over `chunk_vec` for `queryVector`, restricted to chunks owned by `userId` and NOT
 * belonging to `excludeItemId`, de-duplicated to one (best-distance) row per neighbouring item,
 * closest first.
 */
export function findNearestItemsByVector(
  db: DbClient,
  params: FindNearestItemsParams,
): ChunkNeighbor[] {
  const fetchK = params.fetchK ?? Math.max(params.topN * 4, 20)
  const rows = db.$client
    .prepare<[number, number, Float32Array, number, number], RawNeighborRow>(
      `select c.item_id as item_id, min(v.distance) as distance
       from (
         select rowid, distance
         from chunk_vec
         where rowid in (select id from chunks where user_id = ? and item_id != ?)
           and embedding MATCH ?
           and k = ?
         order by distance
       ) v
       join chunks c on c.id = v.rowid
       group by c.item_id
       order by distance
       limit ?`,
    )
    .all(
      params.userId,
      params.excludeItemId,
      Float32Array.from(params.queryVector),
      fetchK,
      params.topN,
    )
  return rows.map((r) => ({ itemId: r.item_id, distance: r.distance }))
}

export interface NewRelationInput {
  itemA: number
  itemB: number
  type: RelationType
  score: number
  rationale?: string
}

/**
 * Inserts a relation, normalizing pair order first (`relations`' own `CHECK(item_a < item_b)` —
 * inserting the inverse pair throws) and doing nothing if this exact `(item_a, item_b, type)` row
 * already exists (`onConflictDoNothing`, backed by `relations_pair_type_unique`) — makes `relate`
 * idempotently re-runnable, same as every other stage.
 */
export function insertRelationIfAbsent(db: DbClient, input: NewRelationInput): void {
  const [itemA, itemB] =
    input.itemA < input.itemB ? [input.itemA, input.itemB] : [input.itemB, input.itemA]
  db.insert(relationsTable)
    .values({ itemA, itemB, type: input.type, score: input.score, rationale: input.rationale })
    .onConflictDoNothing()
    .run()
}

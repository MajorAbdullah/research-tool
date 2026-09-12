/**
 * Chunk persistence — `chunks` (a real Drizzle table) plus `chunk_vec` (sqlite-vec's `vec0`
 * virtual table, which has no Drizzle schema entry at all — see src/db/schema.ts's header for
 * why). Every function still takes the shared `DbClient`; the statements that touch `chunk_vec`
 * drop to `db.$client` (drizzle-orm's documented escape hatch to the underlying better-sqlite3
 * connection), since Drizzle's query builder has nothing to build against a virtual table it
 * doesn't know about.
 *
 * CLAUDE.md non-negotiable: chunk_vec rowids MUST be bound as `BigInt`, never a plain `number` —
 * sqlite-vec rejects a plain JS number with "Only integers are allows for primary key values"
 * (verified against better-sqlite3 13.0.3 / sqlite-vec 0.1.9).
 */
import { eq } from 'drizzle-orm'
import { chunks } from '@/db/schema'
import type { DbClient } from '@/db/client'
import type { ChunkResult } from '@/lib/embeddings'

export type ChunkRow = typeof chunks.$inferSelect

/**
 * Deletes every chunk for an item. The `chunks_vec_ad` trigger (drizzle/0000_init.sql) removes
 * the matching `chunk_vec` rows as a side effect of the `chunks` delete — see that file's header
 * for why orphaned vectors are handled by a trigger rather than here. Makes the `embed` stage
 * idempotently re-runnable (P7.7/7.8): a retry clears whatever an earlier attempt wrote before
 * inserting fresh chunks, instead of appending duplicates.
 */
export function deleteChunksForItem(db: DbClient, itemId: number): void {
  db.delete(chunks).where(eq(chunks.itemId, itemId)).run()
}

export interface InsertChunksInput {
  itemId: number
  embeddingModel: string
  chunks: readonly ChunkResult[]
  vectors: readonly number[][]
}

/**
 * Inserts every chunk for an item and its matching `chunk_vec` row, in lockstep (`chunks[i]` <->
 * `vectors[i]`). Returns the assigned chunk ids, in the same order.
 *
 * Two statements per chunk (a Drizzle insert into `chunks` for the id, then a raw insert into
 * `chunk_vec` for the vector) rather than one bulk insert of each: `chunk_vec`'s rowid must equal
 * the just-assigned `chunks.id`, which only exists once the first insert returns.
 */
export function insertChunksWithVectors(db: DbClient, input: InsertChunksInput): number[] {
  if (input.chunks.length !== input.vectors.length) {
    throw new Error(
      `insertChunksWithVectors: ${input.chunks.length} chunks but ${input.vectors.length} vectors`,
    )
  }
  const insertVecStmt = db.$client.prepare<[bigint, Float32Array]>(
    'insert into chunk_vec (rowid, embedding) values (?, ?)',
  )
  const ids: number[] = []

  for (let i = 0; i < input.chunks.length; i++) {
    const chunk = input.chunks[i]
    const vector = input.vectors[i]
    if (!chunk || !vector) continue // unreachable given the length check above — satisfies noUncheckedIndexedAccess

    const row = db
      .insert(chunks)
      .values({
        itemId: input.itemId,
        ord: chunk.ord,
        text: chunk.text,
        embeddingModel: input.embeddingModel,
        userId: chunk.userId,
        title: chunk.title,
        url: chunk.url,
        publishedAt: chunk.publishedAt,
      })
      .returning({ id: chunks.id })
      .get()

    insertVecStmt.run(BigInt(row.id), Float32Array.from(vector))
    ids.push(row.id)
  }
  return ids
}

interface RawChunkVectorRow {
  id: number
  embedding: Buffer
}

/**
 * Decodes a `chunk_vec` BLOB back into a plain `number[]` — sqlite-vec stores IEEE-754 float32s
 * packed little-endian, the inverse of what happens when a `Float32Array` is bound as an insert
 * parameter (see `insertChunksWithVectors` above).
 */
function decodeVector(buffer: Buffer): number[] {
  const floats = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
  return Array.from(floats)
}

/**
 * The mean of every chunk vector belonging to `itemId` — the item-level embedding the `relate`
 * stage (P7.5/P9.2.1) uses as the query vector for this item's own kNN neighbour search. Returns
 * `undefined` for an item with zero chunks (e.g. empty extracted content) — callers must treat
 * that as "nothing to relate yet," never as an error.
 */
export function meanVectorForItem(
  db: DbClient,
  itemId: number,
  dimensions: number,
): number[] | undefined {
  const rows = db.$client
    .prepare<[number], RawChunkVectorRow>(
      `select c.id as id, v.embedding as embedding
       from chunks c join chunk_vec v on v.rowid = c.id
       where c.item_id = ?`,
    )
    .all(itemId)
  if (rows.length === 0) return undefined

  const mean = new Array<number>(dimensions).fill(0)
  for (const row of rows) {
    const vec = decodeVector(row.embedding)
    for (let i = 0; i < dimensions; i++) {
      mean[i] = (mean[i] ?? 0) + (vec[i] ?? 0) / rows.length
    }
  }
  return mean
}

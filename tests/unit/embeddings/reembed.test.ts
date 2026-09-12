import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import type { EmbeddingProvider } from '@/types/contracts'
import { reembedAll, type ReembedDb } from '@/lib/embeddings/reembed'
import { createSqliteSettingsPort } from '@/lib/ai/settings-store'
import { recordEmbeddingModel } from '@/lib/embeddings/settings-guard'

/** A small (4-dim, not the real 384) in-memory chunks/chunk_vec pair — enough to exercise
 *  reembedAll()'s SQL for real, without pulling in the full production schema. */
function openTestDb(): Database.Database {
  const db = new Database(':memory:')
  sqliteVec.load(db)
  db.exec(`
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      embedding_model TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE chunk_vec USING vec0(embedding float[4]);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  return db
}

function seedChunks(db: Database.Database, count: number, oldModel = 'old-model'): void {
  const insert = db.prepare('INSERT INTO chunks (id, text, embedding_model) VALUES (?, ?, ?)')
  for (let i = 1; i <= count; i++) {
    insert.run(i, `chunk body number ${i}`, oldModel)
  }
}

function fakeProvider(model = 'new-model', dims = 4) {
  const embed = vi.fn(async (texts: string[]) => texts.map((_, i) => [i + 1, i + 1, i + 1, i + 1]))
  const provider: EmbeddingProvider = {
    model,
    dimensions: dims,
    embed,
    embedQuery: vi.fn(async () => [0, 0, 0, 0]),
  }
  return { provider, embed }
}

describe('reembedAll', () => {
  it('re-embeds every chunk in one batch when they all fit under batchSize', async () => {
    const db = openTestDb()
    seedChunks(db, 5)
    const { provider, embed } = fakeProvider()

    const result = await reembedAll({ db: db as unknown as ReembedDb, provider })

    expect(result.chunksProcessed).toBe(5)
    expect(embed).toHaveBeenCalledTimes(1) // one batch, not one call per chunk
    expect(embed.mock.calls[0]?.[0]).toHaveLength(5)
  })

  it('paginates across multiple batches when batchSize is smaller than the chunk count', async () => {
    const db = openTestDb()
    seedChunks(db, 5)
    const { provider, embed } = fakeProvider()

    const result = await reembedAll({ db: db as unknown as ReembedDb, provider, batchSize: 2 })

    expect(result.chunksProcessed).toBe(5)
    expect(embed).toHaveBeenCalledTimes(3) // 2 + 2 + 1
    expect(embed.mock.calls.map((c) => (c[0] as string[]).length)).toEqual([2, 2, 1])
  })

  it('rebuilds chunk_vec with BigInt-bound rowids matching each chunk id (the documented gotcha)', async () => {
    const db = openTestDb()
    seedChunks(db, 3)
    const { provider } = fakeProvider()

    await reembedAll({ db: db as unknown as ReembedDb, provider })

    const rows = db.prepare('SELECT rowid FROM chunk_vec ORDER BY rowid').all() as Array<{ rowid: number }>
    expect(rows.map((r) => r.rowid)).toEqual([1, 2, 3])
  })

  it('inserts correctly even if a provider hands back typed-array vectors instead of plain arrays (regression)', async () => {
    // A live smoke test of this exact CLI caught fastembed returning Float32Array vectors at
    // runtime despite EmbeddingProvider.embed() being frozen as Promise<number[][]> —
    // JSON.stringify() on a typed array serializes as "{"0":...}", which sqlite-vec's insert
    // rejects outright. local-provider.ts now normalizes at the source; this proves reembed.ts's
    // own defensive Array.from() also holds, for any provider that doesn't.
    const db = openTestDb()
    seedChunks(db, 1)
    const provider: EmbeddingProvider = {
      model: 'typed-array-model',
      dimensions: 4,
      embed: async (texts) => texts.map(() => new Float32Array([1, 2, 3, 4]) as unknown as number[]),
      embedQuery: async () => new Float32Array([1, 2, 3, 4]) as unknown as number[],
    }

    await expect(reembedAll({ db: db as unknown as ReembedDb, provider })).resolves.toEqual({
      chunksProcessed: 1,
    })
    const row = db.prepare('SELECT rowid FROM chunk_vec').get() as { rowid: number }
    expect(row.rowid).toBe(1)
  })

  it('overwrites each chunk’s embedding_model with the new provider’s model', async () => {
    const db = openTestDb()
    seedChunks(db, 3, 'old-model')
    const { provider } = fakeProvider('new-model')

    await reembedAll({ db: db as unknown as ReembedDb, provider })

    const rows = db.prepare('SELECT embedding_model FROM chunks').all() as Array<{ embedding_model: string }>
    expect(rows.every((r) => r.embedding_model === 'new-model')).toBe(true)
  })

  it('replaces a chunk’s existing vector rather than leaving a stale duplicate behind', async () => {
    const db = openTestDb()
    seedChunks(db, 1)
    // Seed chunk_vec directly the way an earlier embed pass would have.
    db.prepare('INSERT INTO chunk_vec (rowid, embedding) VALUES (?, ?)').run(
      BigInt(1),
      JSON.stringify([9, 9, 9, 9]),
    )

    const { provider } = fakeProvider()
    await reembedAll({ db: db as unknown as ReembedDb, provider })

    const rows = db.prepare('SELECT rowid, embedding FROM chunk_vec').all() as Array<{
      rowid: number
      embedding: Buffer
    }>
    expect(rows).toHaveLength(1) // no duplicate row for the same chunk
    const floats = new Float32Array(rows[0]!.embedding.buffer, rows[0]!.embedding.byteOffset, 4)
    expect(Array.from(floats)).toEqual([1, 1, 1, 1]) // the NEW vector, not the stale [9,9,9,9]
  })

  it('reports zero chunks processed on an empty table without erroring', async () => {
    const db = openTestDb()
    const { provider, embed } = fakeProvider()
    const result = await reembedAll({ db: db as unknown as ReembedDb, provider })
    expect(result.chunksProcessed).toBe(0)
    expect(embed).not.toHaveBeenCalled()
  })

  it('reports progress as batches complete', async () => {
    const db = openTestDb()
    seedChunks(db, 5)
    const { provider } = fakeProvider()
    const progress: Array<[number, number]> = []

    await reembedAll({
      db: db as unknown as ReembedDb,
      provider,
      batchSize: 2,
      onProgress: (processed, total) => progress.push([processed, total]),
    })

    expect(progress).toEqual([
      [2, 5],
      [4, 5],
      [5, 5],
    ])
  })

  it('composes with settings-guard: after a reembed, the recorded model matches the new provider', async () => {
    const db = openTestDb()
    seedChunks(db, 2, 'old-model')
    const { provider } = fakeProvider('nvidia/nemotron-3-embed-1b:free')

    await reembedAll({ db: db as unknown as ReembedDb, provider })
    recordEmbeddingModel(provider.model, createSqliteSettingsPort(db))

    expect(createSqliteSettingsPort(db).get('embedding_model')).toBe('nvidia/nemotron-3-embed-1b:free')
  })
})

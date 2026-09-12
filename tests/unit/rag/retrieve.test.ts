import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmbeddingProvider } from '@/types/contracts'
import { makeTestDb, fakeEmbedding, type TestDb } from '../../helpers/db'
import { makeUser, makeItem, makeChunk } from '../../helpers/factories'
import { retrieveCandidates } from '@/lib/rag/retrieve'

/** Mirrors tests/unit/search/hybrid-search.test.ts's own fixture — a fake `EmbeddingProvider`
 *  that returns a fixed vector regardless of input text, paired with `makeChunk`'s `seed` option
 *  (`fakeEmbedding(seed)`) so vector "closeness" is deterministic and never touches the real
 *  350 MB ONNX model (CLAUDE.md/qa-testing-best-practices: unit tests stay fast and offline). */
function fakeEmbeddingProvider(
  queryVector: readonly number[] = Array.from(fakeEmbedding(1)),
): EmbeddingProvider {
  return {
    model: 'fake-embedder',
    dimensions: queryVector.length,
    embed: vi.fn(async (texts: string[]) => texts.map(() => [...queryVector])),
    embedQuery: vi.fn(async () => [...queryVector]),
  }
}

describe('retrieveCandidates', () => {
  let db: TestDb
  beforeEach(() => {
    db = makeTestDb()
    makeUser(db, 1)
  })
  afterEach(() => db.close())

  it("hydrates each ranked item's chunks in ord order, capped at maxChunksPerItem", async () => {
    const itemId = makeItem(db, { id: 1, content: 'vllm content', kind: 'github' })
    makeChunk(db, itemId, 'chunk zero text', { ord: 0, seed: 1 })
    makeChunk(db, itemId, 'chunk one text', { ord: 1, seed: 2 })
    makeChunk(db, itemId, 'chunk two text', { ord: 2, seed: 3 })

    const result = await retrieveCandidates(
      { sqlite: db, embeddingProvider: fakeEmbeddingProvider(Array.from(fakeEmbedding(1))) },
      { userId: 1, query: 'vllm', maxChunksPerItem: 2 },
    )

    expect(result.groundedPreGate).toBe(true)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.chunks).toHaveLength(2)
    expect(result.items[0]?.chunks.map((c) => c.ord)).toEqual([0, 1])
  })

  it('is ungrounded (empty items, no LLM-worthy signal) when the corpus is empty', async () => {
    const result = await retrieveCandidates(
      { sqlite: db, embeddingProvider: fakeEmbeddingProvider() },
      { userId: 1, query: 'anything' },
    )
    expect(result.groundedPreGate).toBe(false)
    expect(result.items).toEqual([])
  })

  it('is ungrounded when a kind filter excludes every matching item', async () => {
    const itemId = makeItem(db, { id: 1, content: 'vllm content', kind: 'github' })
    makeChunk(db, itemId, 'vllm content chunk', { seed: 1 })

    const result = await retrieveCandidates(
      { sqlite: db, embeddingProvider: fakeEmbeddingProvider(Array.from(fakeEmbedding(1))) },
      { userId: 1, query: 'vllm', filters: { kind: 'video' } },
    )
    expect(result.groundedPreGate).toBe(false)
    expect(result.items).toEqual([])
  })

  it("scopes strictly by user_id — another user's matching chunk never appears", async () => {
    makeUser(db, 2)
    const otherItem = makeItem(db, { id: 1, userId: 2, content: 'vllm content', kind: 'github' })
    makeChunk(db, otherItem, 'vllm content chunk', { userId: 2, seed: 1 })

    const result = await retrieveCandidates(
      { sqlite: db, embeddingProvider: fakeEmbeddingProvider(Array.from(fakeEmbedding(1))) },
      { userId: 1, query: 'vllm' },
    )
    expect(result.items).toEqual([])
  })

  it("ranks by hybridSearch's own fused order — a weaker-vector item matched by FTS can still outrank a vector-only match", async () => {
    // bothId: far from the query vector (seed 5) but its item content literally contains the
    // query term, so FTS ranks it #1.
    const bothId = makeItem(db, { id: 1, content: 'PagedAttention memory management internals' })
    makeChunk(db, bothId, 'chunk body', { seed: 5 })
    // vectorOnlyId: exactly matches the query vector (seed 1, same as the query embedding below)
    // but shares no words with "PagedAttention" at all, so FTS never returns it.
    const vectorOnlyId = makeItem(db, { id: 2, content: 'completely unrelated words entirely' })
    makeChunk(db, vectorOnlyId, 'chunk body', { seed: 1 })

    const result = await retrieveCandidates(
      { sqlite: db, embeddingProvider: fakeEmbeddingProvider(Array.from(fakeEmbedding(1))) },
      { userId: 1, query: 'PagedAttention' },
    )

    expect(result.items.map((i) => i.itemId)).toEqual([bothId, vectorOnlyId])
  })

  it('records raw per-item FTS rank and vector distance on each hydrated chunk', async () => {
    const itemId = makeItem(db, { id: 1, content: 'vllm PagedAttention content' })
    makeChunk(db, itemId, 'chunk body', { seed: 1 })

    const result = await retrieveCandidates(
      { sqlite: db, embeddingProvider: fakeEmbeddingProvider(Array.from(fakeEmbedding(1))) },
      { userId: 1, query: 'PagedAttention' },
    )

    const chunk = result.items[0]?.chunks[0]
    expect(chunk?.vectorDistance).not.toBeNull()
    expect(chunk?.ftsRank).not.toBeNull()
  })
})

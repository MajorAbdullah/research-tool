import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { vectorSearch } from '@/lib/search/vector-search'
import { makeTestDb, fakeEmbedding, type TestDb } from '../../helpers/db'
import { makeUser, makeItem, makeChunk } from '../../helpers/factories'

describe('vectorSearch', () => {
  let db: TestDb
  beforeEach(() => {
    db = makeTestDb()
    makeUser(db, 1)
  })
  afterEach(() => db.close())

  it('orders hits by ascending distance', () => {
    const near = makeItem(db, { id: 1 })
    const mid = makeItem(db, { id: 2 })
    const far = makeItem(db, { id: 3 })
    makeChunk(db, far, 'far', { seed: 50 })
    makeChunk(db, near, 'near', { seed: 1 })
    makeChunk(db, mid, 'mid', { seed: 10 })

    const hits = vectorSearch(db, {
      userId: 1,
      queryEmbedding: Array.from(fakeEmbedding(1)),
      limit: 10,
    })
    expect(hits[0]?.itemId).toBe(near) // seed 1 == query seed -> distance 0, must rank first
    expect(hits.map((h) => h.distance)).toEqual(
      [...hits.map((h) => h.distance)].sort((a, b) => a - b),
    )
  })

  it('dedupes to items: an item with many matching chunks appears once, ranked by its best chunk', () => {
    const item = makeItem(db, { id: 1 })
    makeChunk(db, item, 'chunk far', { ord: 0, seed: 40 })
    makeChunk(db, item, 'chunk exact', { ord: 1, seed: 1 }) // the best one
    makeChunk(db, item, 'chunk mid', { ord: 2, seed: 20 })

    const other = makeItem(db, { id: 2 })
    makeChunk(db, other, 'other', { seed: 30 })

    const hits = vectorSearch(db, {
      userId: 1,
      queryEmbedding: Array.from(fakeEmbedding(1)),
      limit: 10,
    })
    const itemHits = hits.filter((h) => h.itemId === item)
    expect(itemHits).toHaveLength(1)
    expect(itemHits[0]?.distance).toBe(0)
  })

  it('excludes explicitly-listed item ids (relations\' "do not neighbour yourself")', () => {
    const self = makeItem(db, { id: 1 })
    makeChunk(db, self, 'self', { seed: 1 })
    const other = makeItem(db, { id: 2 })
    makeChunk(db, other, 'other', { seed: 1 })

    const hits = vectorSearch(db, {
      userId: 1,
      queryEmbedding: Array.from(fakeEmbedding(1)),
      limit: 10,
      excludeItemIds: [self],
    })
    expect(hits.map((h) => h.itemId)).toEqual([other])
  })

  it('applies composable filters (e.g. kind) exactly like FTS search does', () => {
    const repo = makeItem(db, { id: 1, kind: 'github' })
    makeChunk(db, repo, 'repo', { seed: 1 })
    const video = makeItem(db, { id: 2, kind: 'video' })
    makeChunk(db, video, 'video', { seed: 1 })

    const hits = vectorSearch(db, {
      userId: 1,
      queryEmbedding: Array.from(fakeEmbedding(1)),
      limit: 10,
      filters: { kind: ['github'] },
    })
    expect(hits.map((h) => h.itemId)).toEqual([repo])
  })

  it('returns [] for an empty chunk_vec table, a non-positive limit, or no matches', () => {
    expect(
      vectorSearch(db, { userId: 1, queryEmbedding: Array.from(fakeEmbedding(1)), limit: 10 }),
    ).toEqual([])

    const item = makeItem(db, { id: 1 })
    makeChunk(db, item, 'x', { seed: 1 })
    expect(
      vectorSearch(db, { userId: 1, queryEmbedding: Array.from(fakeEmbedding(1)), limit: 0 }),
    ).toEqual([])
  })

  describe("access control: another user's chunk is UNREACHABLE, not merely unshown", () => {
    /**
     * The adversarial case verified empirically while designing this module: fifty of "their"
     * chunks sit at the query's EXACT embedding (distance 0) — maximally competitive — while
     * "mine" has exactly one chunk far away. A naive fixed small `k` would return zero rows for
     * me (their fifty crowd out my one within the first `k` globally-nearest), which would look
     * exactly like "my data is unreachable" even though the mechanism is really a recall bug, not
     * a leak. This proves both properties at once: my result is still found (recall), and not one
     * of their fifty closer rows ever appears in it (no leak) — at every limit tried, not just a
     * convenient one.
     */
    it('finds my own (globally worse-ranked) result while never returning a single foreign row', () => {
      makeUser(db, 2)
      const mine = makeItem(db, { id: 100, userId: 1 })
      makeChunk(db, mine, 'my private note', { userId: 1, seed: 999 }) // far from the query

      const theirs = makeItem(db, { id: 200, userId: 2 })
      for (let i = 0; i < 50; i++) {
        makeChunk(db, theirs, `their chunk ${i}`, { userId: 2, ord: i, seed: 1 }) // == query, distance 0
      }

      for (const limit of [1, 5, 20]) {
        const hits = vectorSearch(db, {
          userId: 1,
          queryEmbedding: Array.from(fakeEmbedding(1)),
          limit,
        })
        expect(
          hits.every((h) => h.itemId === mine),
          `limit=${limit}: leaked a foreign item id`,
        ).toBe(true)
        expect(
          hits.map((h) => h.itemId),
          `limit=${limit}: failed to find my own item at all`,
        ).toContain(mine)
      }
    })

    it('the flip side: user 2 can reach their own (globally best-ranked) chunks normally', () => {
      makeUser(db, 2)
      const mine = makeItem(db, { id: 100, userId: 1 })
      makeChunk(db, mine, 'my private note', { userId: 1, seed: 999 })
      const theirs = makeItem(db, { id: 200, userId: 2 })
      makeChunk(db, theirs, 'their note', { userId: 2, seed: 1 })

      const hits = vectorSearch(db, {
        userId: 2,
        queryEmbedding: Array.from(fakeEmbedding(1)),
        limit: 10,
      })
      expect(hits.map((h) => h.itemId)).toEqual([theirs])
    })
  })
})

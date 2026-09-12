import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import {
  computeMeanEmbedding,
  findItemNeighbors,
  similarityFromDistance,
} from '@/lib/relations/neighbors'
import { makeTestDb, fakeEmbedding, EMBEDDING_DIMS, type TestDb } from '../../helpers/db'
import { makeUser, makeItem, makeChunk } from '../../helpers/factories'

describe('computeMeanEmbedding', () => {
  let db: TestDb
  beforeEach(() => {
    db = makeTestDb()
    makeUser(db, 1)
  })
  afterEach(() => db.close())

  it('returns null when the item has no chunks', () => {
    const item = makeItem(db, { id: 1 })
    expect(computeMeanEmbedding(db, item, 1)).toBeNull()
  })

  it('averages a single chunk to itself', () => {
    const item = makeItem(db, { id: 1 })
    makeChunk(db, item, 'x', { seed: 3 })
    const mean = computeMeanEmbedding(db, item, 1)
    expect(mean).not.toBeNull()
    expect(mean).toHaveLength(EMBEDDING_DIMS)
    const expected = Array.from(fakeEmbedding(3))
    mean?.forEach((v, i) => expect(v).toBeCloseTo(expected[i] ?? 0, 5))
  })

  it('component-wise averages multiple chunks', () => {
    const item = makeItem(db, { id: 1 })
    makeChunk(db, item, 'a', { ord: 0, seed: 1 })
    makeChunk(db, item, 'b', { ord: 1, seed: 5 })

    const mean = computeMeanEmbedding(db, item, 1)
    const a = Array.from(fakeEmbedding(1))
    const b = Array.from(fakeEmbedding(5))
    mean?.forEach((v, i) => expect(v).toBeCloseTo(((a[i] ?? 0) + (b[i] ?? 0)) / 2, 5))
  })

  it('only averages this item\'s own chunks, not another item\'s', () => {
    const item = makeItem(db, { id: 1 })
    makeChunk(db, item, 'a', { seed: 1 })
    const other = makeItem(db, { id: 2 })
    makeChunk(db, other, 'b', { seed: 99 })

    const mean = computeMeanEmbedding(db, item, 1)
    const expected = Array.from(fakeEmbedding(1))
    mean?.forEach((v, i) => expect(v).toBeCloseTo(expected[i] ?? 0, 5))
  })
})

describe('findItemNeighbors', () => {
  let db: TestDb
  beforeEach(() => {
    db = makeTestDb()
    makeUser(db, 1)
  })
  afterEach(() => db.close())

  it('returns [] when the item has no chunks', () => {
    const item = makeItem(db, { id: 1 })
    expect(findItemNeighbors(db, { itemId: item, userId: 1 })).toEqual([])
  })

  it('finds the nearest other items, excluding itself', () => {
    const target = makeItem(db, { id: 1 })
    makeChunk(db, target, 'target', { seed: 1 })
    const near = makeItem(db, { id: 2 })
    makeChunk(db, near, 'near', { seed: 1 })
    const far = makeItem(db, { id: 3 })
    makeChunk(db, far, 'far', { seed: 40 })

    const neighbors = findItemNeighbors(db, { itemId: target, userId: 1, topK: 5 })
    expect(neighbors.map((n) => n.itemId)).not.toContain(target)
    expect(neighbors[0]?.itemId).toBe(near)
  })

  it('caps results at topK', () => {
    const target = makeItem(db, { id: 1 })
    makeChunk(db, target, 'target', { seed: 1 })
    for (let i = 2; i <= 8; i++) {
      const other = makeItem(db, { id: i })
      makeChunk(db, other, `n${i}`, { seed: i })
    }
    expect(findItemNeighbors(db, { itemId: target, userId: 1, topK: 3 })).toHaveLength(3)
  })

  it('never crosses the user boundary (reuses vectorSearch\'s access-control guarantee)', () => {
    makeUser(db, 2)
    const target = makeItem(db, { id: 1, userId: 1 })
    makeChunk(db, target, 'target', { userId: 1, seed: 1 })
    const theirs = makeItem(db, { id: 2, userId: 2 })
    makeChunk(db, theirs, 'theirs', { userId: 2, seed: 1 })

    const neighbors = findItemNeighbors(db, { itemId: target, userId: 1, topK: 5 })
    expect(neighbors).toEqual([])
  })
})

describe('similarityFromDistance', () => {
  it('maps 0 distance to 1.0 (identical)', () => {
    expect(similarityFromDistance(0)).toBe(1)
  })

  it('is monotonically decreasing and stays within (0, 1]', () => {
    const scores = [0, 0.1, 1, 5, 100].map(similarityFromDistance)
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1] as number)
    }
    for (const score of scores) {
      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThanOrEqual(1)
    }
  })

  it('clamps a defensive negative distance to 0 rather than exceeding 1', () => {
    expect(similarityFromDistance(-5)).toBe(1)
  })
})

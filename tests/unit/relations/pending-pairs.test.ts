import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { collectPendingPairs, DEFAULT_MAX_PENDING_PAIRS } from '@/lib/relations/pending-pairs'
import { makeTestDb, type TestDb } from '../../helpers/db'
import { makeUser, makeItem, makeChunk } from '../../helpers/factories'

function normalized(pairs: { itemA: number; itemB: number }[]): string[] {
  return pairs.map((p) => `${p.itemA}:${p.itemB}`).sort()
}

describe('collectPendingPairs', () => {
  let db: TestDb
  beforeEach(() => {
    db = makeTestDb()
    makeUser(db, 1)
  })
  afterEach(() => db.close())

  it('returns [] when there are no items with chunks', () => {
    expect(collectPendingPairs(db, { userId: 1 })).toEqual([])
  })

  it('collects a normalized pair for two mutually-nearest items', () => {
    const a = makeItem(db, { id: 1 })
    makeChunk(db, a, 'a', { seed: 1 })
    const b = makeItem(db, { id: 2 })
    makeChunk(db, b, 'b', { seed: 1 })

    const pairs = collectPendingPairs(db, { userId: 1, neighborsPerItem: 5 })
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.itemA).toBeLessThan(pairs[0]?.itemB as number) // CHECK(item_a < item_b)
    expect(normalized(pairs)).toEqual(['1:2'])
  })

  it('does not double-count a pair discovered from both directions', () => {
    // Three items, all mutually close -> each one's neighbour list includes the other two.
    for (const id of [1, 2, 3]) {
      const item = makeItem(db, { id })
      makeChunk(db, item, `x${id}`, { seed: 1 })
    }
    const pairs = collectPendingPairs(db, { userId: 1, neighborsPerItem: 5 })
    // 3 items, all equidistant (same seed) -> exactly the 3 unordered pairs, never more.
    expect(pairs).toHaveLength(3)
    expect(new Set(normalized(pairs)).size).toBe(3)
  })

  it('excludes a pair that already has ANY relations row', () => {
    const a = makeItem(db, { id: 1 })
    makeChunk(db, a, 'a', { seed: 1 })
    const b = makeItem(db, { id: 2 })
    makeChunk(db, b, 'b', { seed: 1 })
    db.prepare('insert into relations (item_a, item_b, type, score) values (1,2,?,0.5)').run('similar')

    expect(collectPendingPairs(db, { userId: 1 })).toEqual([])
  })

  it('respects maxPairs and stops early rather than scoring every candidate', () => {
    // 10 items all mutually close -> C(10,2) = 45 possible pairs, far more than a small cap.
    for (let id = 1; id <= 10; id++) {
      const item = makeItem(db, { id })
      makeChunk(db, item, `x${id}`, { seed: 1 })
    }
    const pairs = collectPendingPairs(db, { userId: 1, maxPairs: 4, neighborsPerItem: 9 })
    expect(pairs.length).toBeLessThanOrEqual(4)
  })

  it('defaults maxPairs to 20', () => {
    for (let id = 1; id <= 12; id++) {
      const item = makeItem(db, { id })
      makeChunk(db, item, `x${id}`, { seed: 1 })
    }
    const pairs = collectPendingPairs(db, { userId: 1, neighborsPerItem: 11 })
    expect(pairs.length).toBeLessThanOrEqual(DEFAULT_MAX_PENDING_PAIRS)
  })

  it('only considers an explicit candidateItemIds set when given one', () => {
    const a = makeItem(db, { id: 1 })
    makeChunk(db, a, 'a', { seed: 1 })
    const b = makeItem(db, { id: 2 })
    makeChunk(db, b, 'b', { seed: 1 })
    const c = makeItem(db, { id: 3 })
    makeChunk(db, c, 'c', { seed: 1 })

    const pairs = collectPendingPairs(db, { userId: 1, candidateItemIds: [1], neighborsPerItem: 5 })
    // Only item 1 is walked as a *source*, but its neighbours (2 and 3) still show up as the
    // other half of a pair — this is "which items we compute neighbours FOR", not a full filter
    // over every id that may appear.
    expect(pairs.every((p) => p.itemA === 1 || p.itemB === 1)).toBe(true)
  })

  it('scopes candidates by userId — another user\'s items are never walked or paired', () => {
    makeUser(db, 2)
    const mine = makeItem(db, { id: 1, userId: 1 })
    makeChunk(db, mine, 'mine', { userId: 1, seed: 1 })
    const theirs = makeItem(db, { id: 2, userId: 2 })
    makeChunk(db, theirs, 'theirs', { userId: 2, seed: 1 })

    expect(collectPendingPairs(db, { userId: 1 })).toEqual([])
  })
})

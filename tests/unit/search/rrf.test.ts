import { describe, expect, it } from 'vitest'
import { reciprocalRankFusion, DEFAULT_RRF_K } from '@/lib/search/rrf'

describe('reciprocalRankFusion', () => {
  it('is empty for empty inputs', () => {
    expect(reciprocalRankFusion({})).toEqual([])
    expect(reciprocalRankFusion({ fts: [], vector: [] })).toEqual([])
  })

  it('preserves the order of a single ranking (RRF of one list is order-preserving)', () => {
    const fused = reciprocalRankFusion({ fts: [10, 20, 30] })
    expect(fused.map((f) => f.id)).toEqual([10, 20, 30])
  })

  it('unions disjoint rankings', () => {
    const fused = reciprocalRankFusion({ fts: [1, 2], vector: [3, 4] })
    expect(new Set(fused.map((f) => f.id))).toEqual(new Set([1, 2, 3, 4]))
  })

  it('sums contributions for an id present in multiple rankings', () => {
    const k = 60
    // id 1: rank 1 in fts, rank 2 in vector -> score = 1/(60+1) + 1/(60+2)
    const fused = reciprocalRankFusion({ fts: [1, 5], vector: [9, 1] }, k)
    const one = fused.find((f) => f.id === 1)
    expect(one).toBeDefined()
    expect(one?.score).toBeCloseTo(1 / (k + 1) + 1 / (k + 2), 10)
    expect(one?.ranks).toEqual({ fts: 1, vector: 2 })
  })

  it('an id appearing in two rankings outranks an id that is rank-1 in only one (the whole point of fusion)', () => {
    // 100: rank 1 in "a", rank 2 in "b" -> score = 1/61 + 1/62
    // 200: absent from "a", rank 1 in "b"          -> score = 1/61
    // 1/61 + 1/62 > 1/61, so 100 must outrank 200 despite 200 being *someone's* top pick.
    const fused = reciprocalRankFusion({ a: [100], b: [200, 100] }, 60)
    const order = fused.map((f) => f.id)
    expect(order.indexOf(100)).toBeLessThan(order.indexOf(200))
  })

  it('breaks ties deterministically by ascending id', () => {
    // Each id is alone, at rank 1, in its own single-item ranking -> identical scores, forcing
    // the tiebreak to be the only thing that decides order.
    const fused = reciprocalRankFusion({ a: [50], b: [7] }, 60)
    expect(fused[0]?.score).toBe(fused[1]?.score)
    expect(fused.map((f) => f.id)).toEqual([7, 50])
  })

  it('sorts by descending fused score', () => {
    const fused = reciprocalRankFusion({ fts: [1, 2, 3] }, DEFAULT_RRF_K)
    const scores = fused.map((f) => f.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('a larger k compresses the score gap between adjacent ranks', () => {
    const smallK = reciprocalRankFusion({ fts: [1, 2] }, 1)
    const largeK = reciprocalRankFusion({ fts: [1, 2] }, 1000)

    const gap = (fused: ReturnType<typeof reciprocalRankFusion>): number => {
      const first = fused.find((f) => f.id === 1)?.score ?? 0
      const second = fused.find((f) => f.id === 2)?.score ?? 0
      return first - second
    }
    expect(gap(largeK)).toBeLessThan(gap(smallK))
  })

  it('matches a hand-computed example exactly', () => {
    // fts:    [1, 2, 3]  (ranks 1,2,3)
    // vector: [2, 1]     (ranks 1,2)
    // k = 60
    // score(1) = 1/61 (fts#1) + 1/62 (vector#2)
    // score(2) = 1/62 (fts#2) + 1/61 (vector#1)  -- same total as id 1, by symmetry
    // score(3) = 1/63 (fts#3 only)
    const fused = reciprocalRankFusion({ fts: [1, 2, 3], vector: [2, 1] }, 60)
    const byId = new Map(fused.map((f) => [f.id, f.score]))
    expect(byId.get(1)).toBeCloseTo(1 / 61 + 1 / 62, 10)
    expect(byId.get(2)).toBeCloseTo(1 / 62 + 1 / 61, 10)
    expect(byId.get(3)).toBeCloseTo(1 / 63, 10)
    expect(byId.get(1)).toBeCloseTo(byId.get(2) as number, 10)
  })
})

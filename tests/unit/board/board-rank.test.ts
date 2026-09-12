import { describe, expect, it } from 'vitest'

import {
  compareForColumn,
  computeRankBetween,
  needsRebalance,
  rebalancedRanks,
  sortForColumn,
} from '@/components/board/board-rank'

describe('computeRankBetween', () => {
  it('picks a positive starting rank for an empty column', () => {
    const rank = computeRankBetween(null, null)
    expect(rank).toBeGreaterThan(0)
  })

  it('inserting at the top lands strictly below the first item', () => {
    const rank = computeRankBetween(null, 1024)
    expect(rank).toBeLessThan(1024)
  })

  it('inserting at the bottom lands strictly above the last item', () => {
    const rank = computeRankBetween(1024, null)
    expect(rank).toBeGreaterThan(1024)
  })

  it('inserting between two items is the exact midpoint', () => {
    expect(computeRankBetween(10, 20)).toBe(15)
  })

  it('leaves room to insert before the first item again later', () => {
    const first = computeRankBetween(null, null)
    const beforeFirst = computeRankBetween(null, first)
    expect(beforeFirst).toBeLessThan(first)
  })
})

describe('needsRebalance', () => {
  it('is false whenever either bound is open (top/bottom of the column)', () => {
    expect(needsRebalance(null, 100)).toBe(false)
    expect(needsRebalance(100, null)).toBe(false)
    expect(needsRebalance(null, null)).toBe(false)
  })

  it('is false for an ordinary gap', () => {
    expect(needsRebalance(10, 20)).toBe(false)
  })

  it('is true once two neighbors are so close their float midpoint would collide with one of them', () => {
    const lo = 10
    const hi = 10 + 1e-9
    expect(needsRebalance(lo, hi)).toBe(true)
  })
})

describe('rebalancedRanks', () => {
  it('assigns strictly ascending ranks in the given order', () => {
    const [first, second, third] = rebalancedRanks(['a', 'b', 'c'])
    expect([first?.id, second?.id, third?.id]).toEqual(['a', 'b', 'c'])
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(third).toBeDefined()
    expect(first?.rank).toBeLessThan(second?.rank as number)
    expect(second?.rank).toBeLessThan(third?.rank as number)
  })

  it('is empty for an empty column', () => {
    expect(rebalancedRanks([])).toEqual([])
  })

  it('spaces every pair of adjacent ranks wide enough that a future midpoint never needs an immediate re-rebalance', () => {
    const result = rebalancedRanks(['a', 'b', 'c', 'd'])
    for (let i = 0; i < result.length - 1; i++) {
      const lo = result[i]?.rank ?? null
      const hi = result[i + 1]?.rank ?? null
      expect(needsRebalance(lo, hi)).toBe(false)
    }
  })
})

interface Fixture {
  id: string
  board_rank: number | null
  created_at: number
}

function fixture(id: string, board_rank: number | null, created_at: number): Fixture {
  return { id, board_rank, created_at }
}

const getRank = (item: Fixture): number | null => item.board_rank
const getCreatedAt = (item: Fixture): number => item.created_at

describe('compareForColumn / sortForColumn', () => {
  it('orders two ranked items ascending by rank', () => {
    const a = fixture('a', 20, 100)
    const b = fixture('b', 10, 200)
    expect(sortForColumn([a, b], getRank, getCreatedAt)).toEqual([b, a])
  })

  it('falls back to newest-first when neither item has a rank', () => {
    const older = fixture('older', null, 100)
    const newer = fixture('newer', null, 200)
    expect(sortForColumn([older, newer], getRank, getCreatedAt)).toEqual([newer, older])
  })

  it('places every ranked item before every unranked item, regardless of creation date', () => {
    const rankedButOld = fixture('ranked-old', 5, 1)
    const unrankedButNew = fixture('unranked-new', null, 999)
    expect(sortForColumn([unrankedButNew, rankedButOld], getRank, getCreatedAt)).toEqual([
      rankedButOld,
      unrankedButNew,
    ])
  })

  it('does not mutate the input array', () => {
    const items = [fixture('b', 2, 1), fixture('a', 1, 2)]
    const copy = [...items]
    sortForColumn(items, getRank, getCreatedAt)
    expect(items).toEqual(copy)
  })

  it('a realistic mixed column sorts ranked-ascending then unranked-newest-first', () => {
    const items = [
      fixture('c-unranked-old', null, 10),
      fixture('a-ranked', 5, 500),
      fixture('d-unranked-new', null, 20),
      fixture('b-ranked', 15, 400),
    ]
    const sorted = sortForColumn(items, getRank, getCreatedAt)
    expect(sorted.map((i) => i.id)).toEqual([
      'a-ranked',
      'b-ranked',
      'd-unranked-new',
      'c-unranked-old',
    ])
  })
})

describe('compareForColumn', () => {
  it('is a valid comparator (antisymmetric on this fixture pair)', () => {
    const a = fixture('a', 1, 0)
    const b = fixture('b', 2, 0)
    expect(Math.sign(compareForColumn(a, b, getRank, getCreatedAt))).toBe(
      -Math.sign(compareForColumn(b, a, getRank, getCreatedAt)),
    )
  })
})

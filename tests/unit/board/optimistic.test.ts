import { describe, expect, it } from 'vitest'

import {
  applyFieldPatch,
  applyRankChange,
  applyStatusChange,
  rollbackFailed,
  summarizeSettled,
} from '@/components/board/optimistic'

interface Fixture {
  id: string
  status: string
  board_rank: number | null
  title: string
}

function fixture(id: string, status: string, board_rank: number | null = null): Fixture {
  return { id, status, board_rank, title: `Item ${id}` }
}

describe('applyFieldPatch', () => {
  it('merges the patch into only the matching item', () => {
    const items = [fixture('a', 'inbox'), fixture('b', 'inbox')]
    const result = applyFieldPatch(items, 'a', { title: 'Renamed' })
    expect(result[0]?.title).toBe('Renamed')
    expect(result[1]?.title).toBe('Item b')
  })

  it('does not mutate the original array or its items', () => {
    const items = [fixture('a', 'inbox')]
    const result = applyFieldPatch(items, 'a', { title: 'Renamed' })
    expect(items[0]?.title).toBe('Item a')
    expect(result).not.toBe(items)
  })

  it('is a no-op when the id is not present', () => {
    const items = [fixture('a', 'inbox')]
    const result = applyFieldPatch(items, 'missing', { title: 'Renamed' })
    expect(result).toEqual(items)
  })
})

describe('applyStatusChange', () => {
  it('updates only the status field', () => {
    const items = [fixture('a', 'inbox')]
    const result = applyStatusChange(items, 'a', 'to_test')
    expect(result[0]?.status).toBe('to_test')
    expect(result[0]?.title).toBe('Item a')
  })
})

describe('applyRankChange', () => {
  it('updates only the board_rank field', () => {
    const items = [fixture('a', 'inbox', null)]
    const result = applyRankChange(items, 'a', 42)
    expect(result[0]?.board_rank).toBe(42)
    expect(result[0]?.status).toBe('inbox')
  })
})

describe('summarizeSettled', () => {
  it('buckets fulfilled and rejected results, preserving id association by index', () => {
    const settled: PromiseSettledResult<unknown>[] = [
      { status: 'fulfilled', value: undefined },
      { status: 'rejected', reason: new Error('boom') },
      { status: 'fulfilled', value: undefined },
    ]
    const result = summarizeSettled(['a', 'b', 'c'], settled, (reason) =>
      reason instanceof Error ? reason.message : 'unknown',
    )
    expect(result.succeeded).toEqual(['a', 'c'])
    expect(result.failed).toEqual([{ id: 'b', message: 'boom' }])
  })

  it('is all-succeeded when every request resolves', () => {
    const settled: PromiseSettledResult<unknown>[] = [
      { status: 'fulfilled', value: undefined },
      { status: 'fulfilled', value: undefined },
    ]
    const result = summarizeSettled(['a', 'b'], settled, () => 'unused')
    expect(result).toEqual({ succeeded: ['a', 'b'], failed: [] })
  })

  it('is all-failed when every request rejects, with per-item messages', () => {
    const settled: PromiseSettledResult<unknown>[] = [
      { status: 'rejected', reason: 'network down' },
      { status: 'rejected', reason: 'network down' },
    ]
    const result = summarizeSettled(['a', 'b'], settled, (reason) => String(reason))
    expect(result.succeeded).toEqual([])
    expect(result.failed).toEqual([
      { id: 'a', message: 'network down' },
      { id: 'b', message: 'network down' },
    ])
  })
})

describe('rollbackFailed', () => {
  it('restores only the failed ids to their pre-mutation snapshot, keeping successes applied', () => {
    const previous = [fixture('a', 'inbox'), fixture('b', 'inbox')]
    // "current" simulates an optimistic apply-to-all: both moved to to_test.
    const current = [fixture('a', 'to_test'), fixture('b', 'to_test')]
    const result = rollbackFailed(current, previous, ['b'])
    expect(result.find((i) => i.id === 'a')?.status).toBe('to_test') // kept — it succeeded
    expect(result.find((i) => i.id === 'b')?.status).toBe('inbox') // rolled back — it failed
  })

  it('leaves an item unchanged if it is marked failed but was not present in the previous snapshot', () => {
    const previous = [fixture('a', 'inbox')]
    const current = [fixture('a', 'to_test'), fixture('new', 'to_test')]
    const result = rollbackFailed(current, previous, ['new'])
    expect(result.find((i) => i.id === 'new')?.status).toBe('to_test')
  })

  it('is a no-op when nothing failed', () => {
    const previous = [fixture('a', 'inbox')]
    const current = [fixture('a', 'to_test')]
    expect(rollbackFailed(current, previous, [])).toEqual(current)
  })
})

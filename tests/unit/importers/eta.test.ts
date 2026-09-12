import { describe, expect, it } from 'vitest'
import { estimateEtaMs, formatDurationHuman } from '../../../src/lib/importers/eta'

describe('estimateEtaMs', () => {
  it('returns 0 when nothing remains', () => {
    expect(
      estimateEtaMs({
        remainingItems: 0,
        now: 0,
        remainingBudgetToday: 100,
        dailyBackgroundBudget: 100,
        resetsAt: 1000,
      }),
    ).toBe(0)
  })

  it('returns Infinity when the daily background budget is zero (drain would never finish)', () => {
    expect(
      estimateEtaMs({
        remainingItems: 5,
        now: 0,
        remainingBudgetToday: 0,
        dailyBackgroundBudget: 0,
        resetsAt: 1000,
      }),
    ).toBe(Number.POSITIVE_INFINITY)
  })

  it('paces a same-day drain at the 18 req/min token-bucket rate', () => {
    // 1 item at requestsPerItem=1 costs exactly one pacing slot: 60_000ms / 18.
    const result = estimateEtaMs({
      remainingItems: 1,
      now: 0,
      remainingBudgetToday: 1000,
      dailyBackgroundBudget: 1000,
      resetsAt: 999_999,
      requestsPerItem: 1,
    })
    expect(result).toBe(Math.ceil(60_000 / 18))
  })

  it('spans multiple full days when the backlog exceeds one day of budget', () => {
    // Nothing left today; exactly 2 full extra days' worth of items, no same-day-pace
    // remainder at all - keeps the expectation exact (no floating-point pacing term).
    const result = estimateEtaMs({
      remainingItems: 200,
      now: 0,
      remainingBudgetToday: 0,
      dailyBackgroundBudget: 100,
      resetsAt: 5_000,
      requestsPerItem: 1,
    })
    expect(result).toBe(5_000 + 2 * 86_400_000)
  })

  it('is monotonically non-decreasing in the number of remaining items', () => {
    const base = { now: 0, remainingBudgetToday: 50, dailyBackgroundBudget: 500, resetsAt: 3_600_000 }
    const smaller = estimateEtaMs({ ...base, remainingItems: 40 })
    const larger = estimateEtaMs({ ...base, remainingItems: 4000 })
    expect(larger).toBeGreaterThan(smaller)
  })
})

describe('formatDurationHuman', () => {
  it('renders 0 or negative as "done"', () => {
    expect(formatDurationHuman(0)).toBe('done')
    expect(formatDurationHuman(-500)).toBe('done')
  })

  it('renders sub-minute durations as "<1m"', () => {
    expect(formatDurationHuman(30_000)).toBe('<1m')
    expect(formatDurationHuman(59_999)).toBe('<1m')
  })

  it('renders exactly one minute as "1m"', () => {
    expect(formatDurationHuman(60_000)).toBe('1m')
  })

  it('renders hours and minutes together', () => {
    expect(formatDurationHuman(2 * 3_600_000 + 5 * 60_000)).toBe('2h 5m')
  })

  it('renders days and hours together', () => {
    expect(formatDurationHuman(3 * 86_400_000 + 4 * 3_600_000)).toBe('3d 4h')
  })

  it('caps precision at two units, dropping minutes once days and hours are both present', () => {
    expect(formatDurationHuman(3 * 86_400_000 + 4 * 3_600_000 + 30 * 60_000)).toBe('3d 4h')
  })

  it('renders non-finite input as "unknown"', () => {
    expect(formatDurationHuman(Number.POSITIVE_INFINITY)).toBe('unknown')
    expect(formatDurationHuman(Number.NaN)).toBe('unknown')
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildTimestampMs,
  daysInMonth,
  detectDateOrder,
  normalizeYear,
  type RawTimestampComponents,
} from '../../../src/lib/importers/timestamp'

function components(overrides: Partial<RawTimestampComponents> = {}): RawTimestampComponents {
  return {
    comp1: 1,
    comp2: 1,
    year: 2026,
    hour: 10,
    minute: 0,
    second: 0,
    meridiem: null,
    ...overrides,
  }
}

describe('normalizeYear', () => {
  it('expands a 2-digit year to 20xx', () => {
    expect(normalizeYear('26')).toBe(2026)
    expect(normalizeYear('05')).toBe(2005)
  })

  it('passes a 4-digit year through unchanged', () => {
    expect(normalizeYear('2026')).toBe(2026)
  })
})

describe('detectDateOrder', () => {
  it('is certain DMY when the first component ever exceeds 12', () => {
    expect(
      detectDateOrder([
        { comp1: 5, comp2: 5 },
        { comp1: 13, comp2: 9 },
      ]),
    ).toEqual({
      order: 'DMY',
      confidence: 'certain',
    })
  })

  it('is certain MDY when the second component ever exceeds 12', () => {
    expect(
      detectDateOrder([
        { comp1: 5, comp2: 5 },
        { comp1: 9, comp2: 25 },
      ]),
    ).toEqual({
      order: 'MDY',
      confidence: 'certain',
    })
  })

  it('falls back to assumed DMY when every pair is ambiguous', () => {
    expect(
      detectDateOrder([
        { comp1: 1, comp2: 2 },
        { comp1: 3, comp2: 4 },
      ]),
    ).toEqual({
      order: 'DMY',
      confidence: 'assumed',
    })
  })

  it('assumes DMY on a completely empty file (no headers at all)', () => {
    expect(detectDateOrder([])).toEqual({ order: 'DMY', confidence: 'assumed' })
  })

  it('uses the first disambiguating evidence encountered', () => {
    // comp1=15 fixes DMY before a later, contradictory-looking comp2=20 is reached.
    expect(
      detectDateOrder([
        { comp1: 15, comp2: 5 },
        { comp1: 5, comp2: 20 },
      ]),
    ).toEqual({ order: 'DMY', confidence: 'certain' })
  })
})

describe('daysInMonth', () => {
  it('knows February in a leap year has 29 days', () => {
    expect(daysInMonth(2024, 2)).toBe(29)
  })

  it('knows February in a non-leap year has 28 days', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
  })

  it('knows a 30-day month', () => {
    expect(daysInMonth(2026, 9)).toBe(30)
  })

  it('knows a 31-day month', () => {
    expect(daysInMonth(2026, 1)).toBe(31)
  })
})

describe('buildTimestampMs', () => {
  it('builds a 24-hour timestamp under DMY order', () => {
    const result = buildTimestampMs(
      components({ comp1: 12, comp2: 9, hour: 16, minute: 35, second: 20 }),
      'DMY',
    )
    expect(result).toEqual({ ok: true, timestampMs: Date.UTC(2026, 8, 12, 16, 35, 20) })
  })

  it('builds the same wall-clock date under MDY order with swapped components', () => {
    const result = buildTimestampMs(
      components({ comp1: 9, comp2: 12, hour: 16, minute: 35, second: 20 }),
      'MDY',
    )
    expect(result).toEqual({ ok: true, timestampMs: Date.UTC(2026, 8, 12, 16, 35, 20) })
  })

  it('converts 12 AM to hour 0 (midnight)', () => {
    const result = buildTimestampMs(components({ hour: 12, meridiem: 'AM' }), 'DMY')
    expect(result).toEqual({ ok: true, timestampMs: Date.UTC(2026, 0, 1, 0, 0, 0) })
  })

  it('converts 12 PM to hour 12 (noon)', () => {
    const result = buildTimestampMs(components({ hour: 12, meridiem: 'PM' }), 'DMY')
    expect(result).toEqual({ ok: true, timestampMs: Date.UTC(2026, 0, 1, 12, 0, 0) })
  })

  it('converts 4 PM to hour 16', () => {
    const result = buildTimestampMs(components({ hour: 4, meridiem: 'PM' }), 'DMY')
    expect(result).toEqual({ ok: true, timestampMs: Date.UTC(2026, 0, 1, 16, 0, 0) })
  })

  it('rejects a month above 12', () => {
    const result = buildTimestampMs(components({ comp1: 1, comp2: 99 }), 'DMY')
    expect(result.ok).toBe(false)
  })

  it('rejects a day that does not exist in the given month', () => {
    // 31 Sept (DMY) doesn't exist - September has 30 days.
    const result = buildTimestampMs(components({ comp1: 31, comp2: 9 }), 'DMY')
    expect(result.ok).toBe(false)
  })

  it('rejects an hour above 23 on a 24-hour clock', () => {
    const result = buildTimestampMs(components({ hour: 24 }), 'DMY')
    expect(result.ok).toBe(false)
  })

  it('rejects an hour of 0 on a 12-hour clock (must be 1-12)', () => {
    const result = buildTimestampMs(components({ hour: 0, meridiem: 'AM' }), 'DMY')
    expect(result.ok).toBe(false)
  })

  it('rejects a minute above 59', () => {
    const result = buildTimestampMs(components({ minute: 60 }), 'DMY')
    expect(result.ok).toBe(false)
  })

  it('rejects a second above 59', () => {
    const result = buildTimestampMs(components({ second: 60 }), 'DMY')
    expect(result.ok).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  dateInputValueToEpochMs,
  epochMsToDateInputValue,
  formatCompactNumber,
  formatDate,
  formatDateTime,
} from '@/components/library/format'

describe('formatDate', () => {
  it('renders a medium-style date from a UTC epoch-ms timestamp', () => {
    // 2026-09-12T00:00:00.000Z — assert only on the parts stable across CI timezones.
    const result = formatDate(1789171200000)
    expect(result).toMatch(/2026/)
    expect(result).toMatch(/Sep/)
  })
})

describe('formatDateTime', () => {
  it('includes both a date and a time-of-day', () => {
    const result = formatDateTime(1789171200000)
    expect(result).toMatch(/2026/)
    expect(result).toMatch(/\d{1,2}:\d{2}/)
  })
})

describe('formatCompactNumber', () => {
  it('leaves small counts untouched', () => {
    expect(formatCompactNumber(999)).toBe('999')
  })

  it('compacts thousands and ten-thousands with one decimal place', () => {
    expect(formatCompactNumber(1000)).toBe('1K')
    expect(formatCompactNumber(91557)).toBe('91.6K')
  })

  it('compacts millions', () => {
    expect(formatCompactNumber(1234567)).toBe('1.2M')
  })

  it('handles zero', () => {
    expect(formatCompactNumber(0)).toBe('0')
  })
})

describe('epochMsToDateInputValue / dateInputValueToEpochMs', () => {
  it('returns an empty string for an unset bound, and undefined for an empty value', () => {
    expect(epochMsToDateInputValue(undefined)).toBe('')
    expect(dateInputValueToEpochMs('', 'start')).toBeUndefined()
  })

  it('round-trips a local calendar date to the start/end of that day', () => {
    const value = '2026-09-12'
    const start = dateInputValueToEpochMs(value, 'start')
    const end = dateInputValueToEpochMs(value, 'end')
    expect(start).toBeDefined()
    expect(end).toBeDefined()
    expect(epochMsToDateInputValue(start)).toBe(value)
    expect(epochMsToDateInputValue(end)).toBe(value)
    expect(start!).toBeLessThan(end!)
    expect(end! - start!).toBe(24 * 60 * 60 * 1000 - 1)
  })

  it('rejects a malformed date string rather than throwing', () => {
    expect(dateInputValueToEpochMs('not-a-date', 'start')).toBeUndefined()
    expect(dateInputValueToEpochMs('2026-9-1', 'start')).toBeUndefined()
  })
})

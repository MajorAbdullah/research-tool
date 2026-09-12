import { describe, expect, it } from 'vitest'
import {
  encodeSearchCursor,
  decodeSearchCursor,
  paginateFused,
  type SearchCursor,
} from '@/lib/search/pagination'

describe('search cursor encode/decode', () => {
  it('round-trips', () => {
    const cursor: SearchCursor = { score: 0.0321, id: 42 }
    expect(decodeSearchCursor(encodeSearchCursor(cursor))).toEqual(cursor)
  })

  it('returns undefined for a missing cursor', () => {
    expect(decodeSearchCursor(undefined)).toBeUndefined()
  })

  it('returns undefined for garbage that is not valid base64/JSON', () => {
    expect(decodeSearchCursor('not-a-real-cursor!!!')).toBeUndefined()
  })

  it('returns undefined for well-formed JSON missing the expected shape', () => {
    const garbled = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString('base64url')
    expect(decodeSearchCursor(garbled)).toBeUndefined()
  })
})

interface Row {
  id: number
  score: number
}

function sorted(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id - b.id))
}

describe('paginateFused', () => {
  const rows = sorted([
    { id: 1, score: 0.9 },
    { id: 2, score: 0.8 },
    { id: 3, score: 0.8 }, // ties with id 2 -> id 2 sorts first (ascending id tiebreak)
    { id: 4, score: 0.5 },
    { id: 5, score: 0.1 },
  ])

  it('returns the first page when there is no cursor', () => {
    const { page, hasMore } = paginateFused(rows, undefined, 2)
    expect(page.map((r) => r.id)).toEqual([1, 2])
    expect(hasMore).toBe(true)
  })

  it('resumes strictly after the cursor row, with no skip or duplicate', () => {
    const first = paginateFused(rows, undefined, 2)
    const last = first.page[first.page.length - 1]
    expect(last).toBeDefined()
    const cursor: SearchCursor = { score: last!.score, id: last!.id }

    const second = paginateFused(rows, cursor, 2)
    expect(second.page.map((r) => r.id)).toEqual([3, 4])
    expect(second.hasMore).toBe(true)

    const third = paginateFused(rows, { score: 0.5, id: 4 }, 2)
    expect(third.page.map((r) => r.id)).toEqual([5])
    expect(third.hasMore).toBe(false)
  })

  it('is unaffected by a new row inserted ahead of the cursor position (no re-skip/re-dup)', () => {
    const cursor: SearchCursor = { score: 0.8, id: 2 }
    const withNewRow = sorted([...rows, { id: 0, score: 0.95 }])
    const { page } = paginateFused(withNewRow, cursor, 10)
    // Still resumes strictly after (0.8, 2) — the new higher-scored row 0 never appears on this
    // page, and nothing already seen (1, 2) reappears either.
    expect(page.map((r) => r.id)).toEqual([3, 4, 5])
  })

  it('sets hasMore to false exactly at the last page', () => {
    const { hasMore } = paginateFused(rows, undefined, rows.length)
    expect(hasMore).toBe(false)
  })

  it('handles an empty input', () => {
    expect(paginateFused([], undefined, 10)).toEqual({ page: [], hasMore: false })
  })
})

import { describe, expect, it } from 'vitest'
import { dateBucketFor, groupItems } from '@/components/library/group-items'
import type { ItemSummary } from '@/components/library/types'

let nextId = 1
function makeItem(overrides: Partial<ItemSummary> = {}): ItemSummary {
  const id = nextId++
  return {
    id: `itm_${id}`,
    kind: 'article',
    status: 'inbox',
    title: `Item ${id}`,
    author: null,
    url: `https://example.com/${id}`,
    canonical_url: `https://example.com/${id}`,
    thumbnail_url: null,
    extraction_tier: 'full',
    source_surface: 'web',
    summary_tldr: null,
    topic: null,
    tags: [],
    starred: false,
    board_rank: null,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    last_opened_at: null,
    ...overrides,
  }
}

describe('groupItems — kind', () => {
  it('orders present kinds by the canonical order and omits absent ones', () => {
    const items = [
      makeItem({ kind: 'pdf' }),
      makeItem({ kind: 'github' }),
      makeItem({ kind: 'video' }),
    ]
    const groups = groupItems(items, 'kind')
    expect(groups.map((g) => g.key)).toEqual(['github', 'video', 'pdf'])
    expect(groups.map((g) => g.label)).toEqual(['Repos', 'Videos', 'PDFs'])
    expect(groups.every((g) => g.items.length === 1)).toBe(true)
  })

  it('keeps every item from the input inside exactly one group', () => {
    const items = [
      makeItem({ kind: 'video' }),
      makeItem({ kind: 'video' }),
      makeItem({ kind: 'audio' }),
    ]
    const groups = groupItems(items, 'kind')
    const total = groups.reduce((sum, g) => sum + g.items.length, 0)
    expect(total).toBe(items.length)
  })
})

describe('groupItems — status', () => {
  it('orders present statuses in pipeline order', () => {
    const items = [
      makeItem({ status: 'archived' }),
      makeItem({ status: 'inbox' }),
      makeItem({ status: 'testing' }),
    ]
    const groups = groupItems(items, 'status')
    expect(groups.map((g) => g.key)).toEqual(['inbox', 'testing', 'archived'])
  })
})

describe('groupItems — topic', () => {
  it('sorts by item count descending, then label ascending, with "No topic" always last', () => {
    const topicA = { slug: 'a', label: 'Alpha', color: '#000', confidence: 1 }
    const topicB = { slug: 'b', label: 'Beta', color: '#000', confidence: 1 }
    const topicC = { slug: 'c', label: 'Charlie', color: '#000', confidence: 1 }

    const items = [
      makeItem({ topic: topicB }),
      makeItem({ topic: null }),
      makeItem({ topic: topicA }),
      makeItem({ topic: topicA }),
      makeItem({ topic: topicC }),
      makeItem({ topic: topicC }),
    ]
    const groups = groupItems(items, 'topic')
    // Alpha and Charlie both have 2 items -> alphabetical tiebreak; Beta has 1; "No topic" last.
    expect(groups.map((g) => g.label)).toEqual(['Alpha', 'Charlie', 'Beta', 'No topic'])
  })
})

describe('dateBucketFor', () => {
  const now = new Date(2026, 8, 12, 15, 0, 0).getTime() // Sep 12 2026, 3pm local

  it('buckets today, yesterday, this week, and this month correctly, in increasing rank order', () => {
    const today = dateBucketFor(new Date(2026, 8, 12, 9).getTime(), now)
    const yesterday = dateBucketFor(new Date(2026, 8, 11, 9).getTime(), now)
    const thisWeek = dateBucketFor(new Date(2026, 8, 6, 9).getTime(), now)
    const thisMonth = dateBucketFor(new Date(2026, 8, 1, 9).getTime(), now)

    expect(today.label).toBe('Today')
    expect(yesterday.label).toBe('Yesterday')
    expect(thisWeek.label).toBe('This week')
    expect(thisMonth.label).toBe('This month')
    expect(today.rank).toBeLessThan(yesterday.rank)
    expect(yesterday.rank).toBeLessThan(thisWeek.rank)
    expect(thisWeek.rank).toBeLessThan(thisMonth.rank)
  })

  it('treats a future timestamp (clock skew) as today rather than a negative/invalid bucket', () => {
    const future = dateBucketFor(new Date(2026, 8, 20).getTime(), now)
    expect(future.label).toBe('Today')
  })

  it('buckets earlier months by name, older further back in rank', () => {
    const august = dateBucketFor(new Date(2026, 7, 20).getTime(), now)
    const lastDecember = dateBucketFor(new Date(2025, 11, 25).getTime(), now)

    expect(august.label).toBe('August 2026')
    expect(lastDecember.label).toBe('December 2025')
    expect(august.rank).toBeLessThan(lastDecember.rank)
  })
})

describe('groupItems — date', () => {
  const now = new Date(2026, 8, 12, 15, 0, 0).getTime()

  it('groups into human buckets ordered most-recent-first', () => {
    const items = [
      makeItem({ created_at: new Date(2025, 11, 25).getTime() }), // December 2025
      makeItem({ created_at: new Date(2026, 8, 12, 8).getTime() }), // Today
      makeItem({ created_at: new Date(2026, 8, 11, 8).getTime() }), // Yesterday
    ]
    const groups = groupItems(items, 'date', now)
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'December 2025'])
  })
})

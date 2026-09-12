import { describe, expect, it } from 'vitest'
import { pickSearchItems } from '@/components/library/pick-search-items'
import type { SearchResultSummary } from '@/components/library/types'

function makeResult(id: string): SearchResultSummary {
  return {
    id,
    kind: 'article',
    status: 'inbox',
    title: id,
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
    created_at: 0,
    updated_at: 0,
    last_opened_at: null,
    snippet: 'a snippet',
    score: 0.5,
  }
}

describe('pickSearchItems', () => {
  it('shows the fast FTS tier while the fused hybrid tier has not resolved yet', () => {
    const fts = [makeResult('a')]
    expect(pickSearchItems(fts, [], false)).toBe(fts)
  })

  it('prefers the hybrid tier once it resolves, even though it is a different array', () => {
    const fts = [makeResult('a')]
    const hybrid = [makeResult('b'), makeResult('c')]
    expect(pickSearchItems(fts, hybrid, true)).toBe(hybrid)
  })

  it('shows a genuinely empty hybrid result rather than falling back to a stale FTS result', () => {
    const fts = [makeResult('a')]
    expect(pickSearchItems(fts, [], true)).toEqual([])
  })

  it('shows nothing before either tier has resolved', () => {
    expect(pickSearchItems([], [], false)).toEqual([])
  })
})

import type { ItemSummary } from '@/components/board/board-types'

/** A minimal-but-complete `ItemSummary`, overridable per test — shared by every test in this dir. */
export function fakeItem(overrides: Partial<ItemSummary> & Pick<ItemSummary, 'id'>): ItemSummary {
  return {
    kind: 'github',
    status: 'inbox',
    title: null,
    author: null,
    url: 'https://example.com',
    canonical_url: 'https://example.com',
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
    ...overrides,
  }
}

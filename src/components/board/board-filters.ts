/**
 * Board filters (plan §10, P11.5: "Board filters by topic / kind — 'Only repos in To Test'").
 *
 * Filtered client-side against the already-fetched item set rather than re-querying
 * `GET /api/v1/items` per filter change: the board loads every board-relevant item up front in
 * one paginated fetch (api.ts's `fetchAllItems`) to bucket into columns anyway, and at Sieve's
 * documented scale (CLAUDE.md: single user, one container) filtering an in-memory array is both
 * simpler and instant compared to a network round trip per filter change.
 */

import type { BoardFilters, ItemSummary } from './board-types'

export function matchesFilters(item: ItemSummary, filters: BoardFilters): boolean {
  if (filters.kind && item.kind !== filters.kind) return false
  if (filters.topic && item.topic?.slug !== filters.topic) return false
  return true
}

export function applyFilters(items: readonly ItemSummary[], filters: BoardFilters): ItemSummary[] {
  return items.filter((item) => matchesFilters(item, filters))
}

export function hasActiveFilters(filters: BoardFilters): boolean {
  return filters.kind !== null || filters.topic !== null
}

export interface TopicOption {
  slug: string
  label: string
}

/** Distinct topics present in the full item set, for populating the topic filter — sorted by label. */
export function collectTopics(items: readonly ItemSummary[]): TopicOption[] {
  const seen = new Map<string, string>()
  for (const item of items) {
    if (item.topic && !seen.has(item.topic.slug)) seen.set(item.topic.slug, item.topic.label)
  }
  return Array.from(seen, ([slug, label]) => ({ slug, label })).sort((a, b) =>
    a.label.localeCompare(b.label),
  )
}

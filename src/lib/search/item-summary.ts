/**
 * Batch-hydrates ranked item ids into docs/API.md §2's `ItemSummary` wire shape (plus the two
 * search-only fields, §3.2: `snippet`, `score`). One round trip per shape (items, tags, topics) —
 * never N+1 per item — since a search results page routinely hydrates 10-100 ids at once.
 */

import type Database from 'better-sqlite3'
import type { ExtractionTier, ItemKind, ItemStatus, SourceSurface } from '@/types/contracts'

export interface WireTopic {
  slug: string
  label: string
  color: string
  confidence: number
}

/** Mirrors docs/API.md §2 `ItemSummary` plus §3.2's two search-only fields. Field names are
 *  snake_case because this IS the wire shape — the route JSON-serializes it directly. */
export interface SearchResultItem {
  id: string
  kind: ItemKind
  status: ItemStatus
  title: string | null
  author: string | null
  url: string
  canonical_url: string
  thumbnail_url: string | null
  extraction_tier: ExtractionTier | null
  source_surface: SourceSurface
  summary_tldr: string | null
  topic: WireTopic | null
  tags: string[]
  starred: boolean
  board_rank: number | null
  created_at: number
  updated_at: number
  last_opened_at: number | null
  snippet: string | null
  score: number
}

/** Used only when a topic row exists but its `color` is unset — docs/API.md's `Topic.color` is
 *  non-nullable on the wire, and topic creation isn't this module's concern (P3/P5 own it), so a
 *  neutral fallback keeps this mapper's output contract-conformant regardless of upstream data
 *  completeness. */
const FALLBACK_TOPIC_COLOR = '#6b7280'

/** `itm_` + the raw numeric id. Opaque per docs/API.md §1.3 ("don't parse structure out of
 *  them") — callers must not rely on this exact encoding, even though it is trivially reversible. */
export function toItemWireId(id: number): string {
  return `itm_${id}`
}

interface RawItemRow {
  id: number
  kind: string
  status: string
  title: string | null
  author: string | null
  url: string
  canonical_url: string
  thumbnail_url: string | null
  extraction_tier: string | null
  source_surface: string
  summary_tldr: string | null
  starred: number
  board_rank: number | null
  created_at: number
  updated_at: number
  last_opened_at: number | null
}

interface RawTagRow {
  item_id: number
  label: string
}

interface RawTopicRow {
  item_id: number
  slug: string
  label: string
  color: string | null
  confidence: number
}

export type ItemSummaryBase = Omit<SearchResultItem, 'snippet' | 'score'>

/**
 * Loads items + their tags + their single highest-confidence topic, keyed by item id.
 * `userId`-scoped defensively even though every caller has already produced `itemIds` from a
 * user-scoped ranking — belt and suspenders, cheap here, and it means this function alone is
 * never the one place an access-control regression could slip through.
 */
export function loadItemSummaryRows(
  sqlite: Database.Database,
  itemIds: readonly number[],
  userId: number,
): Map<number, ItemSummaryBase> {
  const result = new Map<number, ItemSummaryBase>()
  if (itemIds.length === 0) return result

  const placeholders = itemIds.map(() => '?').join(',')

  const items = sqlite
    .prepare(
      `SELECT id, kind, status, title, author, url, canonical_url, thumbnail_url,
              extraction_tier, source_surface, summary_tldr, starred, board_rank,
              created_at, updated_at, last_opened_at
         FROM items WHERE id IN (${placeholders}) AND user_id = ?`,
    )
    .all(...itemIds, userId) as RawItemRow[]

  const tagsByItem = new Map<number, string[]>()
  const tagRows = sqlite
    .prepare(
      `SELECT it.item_id AS item_id, t.label AS label
         FROM item_tags it JOIN tags t ON t.id = it.tag_id
        WHERE it.item_id IN (${placeholders})`,
    )
    .all(...itemIds) as RawTagRow[]
  for (const row of tagRows) {
    const list = tagsByItem.get(row.item_id) ?? []
    list.push(row.label)
    tagsByItem.set(row.item_id, list)
  }

  const topicByItem = new Map<number, RawTopicRow>()
  const topicRows = sqlite
    .prepare(
      `SELECT itp.item_id AS item_id, tp.slug AS slug, tp.label AS label, tp.color AS color,
              itp.confidence AS confidence
         FROM item_topics itp JOIN topics tp ON tp.id = itp.topic_id
        WHERE itp.item_id IN (${placeholders})
        ORDER BY itp.confidence DESC, tp.id ASC`,
    )
    .all(...itemIds) as RawTopicRow[]
  for (const row of topicRows) {
    // First row wins per item_id, courtesy of the ORDER BY above — that's the "single primary
    // topic" docs/API.md §4 resolves the possibly-multi-row `item_topics` join table down to.
    if (!topicByItem.has(row.item_id)) topicByItem.set(row.item_id, row)
  }

  for (const row of items) {
    const topic = topicByItem.get(row.id)
    result.set(row.id, {
      id: toItemWireId(row.id),
      kind: row.kind as ItemKind,
      status: row.status as ItemStatus,
      title: row.title,
      author: row.author,
      url: row.url,
      canonical_url: row.canonical_url,
      thumbnail_url: row.thumbnail_url,
      extraction_tier: row.extraction_tier as ExtractionTier | null,
      source_surface: row.source_surface as SourceSurface,
      summary_tldr: row.summary_tldr,
      topic: topic
        ? {
            slug: topic.slug,
            label: topic.label,
            color: topic.color ?? FALLBACK_TOPIC_COLOR,
            confidence: topic.confidence,
          }
        : null,
      tags: tagsByItem.get(row.id) ?? [],
      starred: row.starred === 1,
      board_rank: row.board_rank,
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_opened_at: row.last_opened_at,
    })
  }

  return result
}

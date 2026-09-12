/**
 * Maps an `items` DB row (plus its batch-loaded topic/tags/relations) to the HTTP wire shapes in
 * `wire-types.ts`. The one place that decides, e.g., what a `null` `extraction_tier` becomes on
 * the wire — every route in this phase renders items through this, never by hand, so the two
 * response shapes (`ItemSummary` in lists, `Item` in detail/mutation responses) can't drift.
 */

import type { items } from '@/db/schema'
import { ExtractionTier } from '@/types/contracts'
import { toItemId } from '@/services/ids'
import type {
  GithubKindFieldsWire,
  ItemRelationWire,
  ItemSummaryWire,
  ItemWire,
  WireTopic,
} from '@/services/wire-types'

export type ItemRow = typeof items.$inferSelect

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nullableNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * `kind_fields` is a loose JSON bag on the DB row (schema.ts's own comment: "shape varies by
 * kind... stays a loose bag rather than a typed column") — only surfaced for `github` items, and
 * read defensively since the pipeline that populates it (out of this phase's scope) may not have
 * filled in every field yet.
 */
function mapKindFields(kind: string, raw: unknown): GithubKindFieldsWire | null {
  if (kind !== 'github' || typeof raw !== 'object' || raw === null) return null
  const bag = raw as Record<string, unknown>
  return {
    language: str(bag.language),
    stars: num(bag.stars),
    license: str(bag.license),
    last_commit: nullableNum(bag.lastCommit ?? bag.last_commit),
    what_it_does: str(bag.whatItDoes ?? bag.what_it_does),
    primary_use_case: str(bag.primaryUseCase ?? bag.primary_use_case),
  }
}

export function mapItemSummary(
  row: ItemRow,
  topic: WireTopic | null,
  tagLabels: string[],
): ItemSummaryWire {
  return {
    id: toItemId(row.id),
    kind: row.kind,
    status: row.status,
    title: row.title,
    author: row.author,
    url: row.url,
    canonical_url: row.canonicalUrl,
    thumbnail_url: row.thumbnailUrl,
    // A null DB value means "extraction hasn't produced a tier yet" (freshly queued) — the
    // honest wire value for that is the floor of the ladder, `metadata_only` (docs/API.md §1.8),
    // never a bare null the contract doesn't define.
    extraction_tier: row.extractionTier ?? ExtractionTier.MetadataOnly,
    source_surface: row.sourceSurface,
    summary_tldr: row.summaryTldr,
    topic,
    tags: tagLabels,
    starred: row.starred,
    board_rank: row.boardRank,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    last_opened_at: row.lastOpenedAt,
  }
}

export function mapItem(
  row: ItemRow,
  topic: WireTopic | null,
  tagLabels: string[],
  relations: ItemRelationWire[],
): ItemWire {
  return {
    ...mapItemSummary(row, topic, tagLabels),
    summary_bullets: row.summaryBullets ?? [],
    content_text: row.contentText,
    published_at: row.publishedAt,
    kind_fields: mapKindFields(row.kind, row.kindFields),
    note: row.note,
    outcome_note: row.outcomeNote,
    failure_reason: row.failureReason,
    relations,
  }
}

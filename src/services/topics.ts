/**
 * Topic assignment for `PATCH /api/v1/items/:id`'s `topic` field (docs/API.md §3.5) and for
 * resolving each item's single "primary" topic everywhere it's rendered (§2 `ItemSummary.topic`).
 *
 * The `item_topics` join table (schema.ts) has no separate "who assigned this" column — the
 * manual-override convention lives entirely in `confidence`, per docs/API.md §2's own comment on
 * `Topic.confidence`: "0..1, how sure the enrichment step was; 1.0 for a manual override." So:
 *
 *  - A manual PATCH upserts the chosen topic's row with `confidence = 1` WITHOUT deleting the
 *    AI's own row for a different topic (if any) — that's what makes "clear the override, revert
 *    to whatever the AI last assigned" (docs/API.md §3.5) possible at all.
 *  - "The item's primary topic" is simply whichever row has the highest confidence, so a manual
 *    override (1.0) naturally wins over an AI assignment (< 1.0 in practice) without needing a
 *    separate "is this the active one" flag.
 *  - Clearing an override deletes the row(s) at exactly `confidence = 1`. Edge case, accepted as
 *    a limitation of reusing this one column: if a manual override happens to target the SAME
 *    topic the AI already assigned, the AI's original (lower) confidence is overwritten, not
 *    preserved alongside it — clearing afterwards removes that topic entirely rather than
 *    "reverting" to the AI's original confidence value, since nothing kept a second copy of it.
 *    Fixing that would need a schema column this phase isn't scoped to add.
 */

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type Database from 'better-sqlite3'
import { itemTags, itemTopics, tags, topics } from '@/db/schema'
import { scopedTo } from '@/repositories/scoping'
import type { DbOrTx } from '@/services/db-types'

export interface PrimaryTopic {
  slug: string
  label: string
  color: string
  confidence: number
}

/** The manual-override marker per docs/API.md §2 — see file header. */
export const MANUAL_OVERRIDE_CONFIDENCE = 1

/** Small, deliberate fixed palette (ui-ux-best-practices.md: no sprawling color set) for topics a human names manually. */
const TOPIC_COLOR_PALETTE = [
  '#6366f1', // indigo
  '#0ea5e9', // sky
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
]

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

/** Deterministic color pick so the same slug always renders the same chip color. */
export function colorForSlug(slug: string): string {
  const palette = TOPIC_COLOR_PALETTE
  return palette[hashString(slug) % palette.length] as string
}

/** `"video-diffusion"` -> `"Video Diffusion"` — the default label for a manually-created topic. */
export function slugToLabel(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** Finds a user's topic by slug, creating it (with a derived label/color) if it doesn't exist yet. */
export function findOrCreateTopic(
  db: DbOrTx,
  userId: number,
  slug: string,
): { id: number; slug: string; label: string; color: string | null } {
  const existing = db
    .select()
    .from(topics)
    .where(scopedTo(topics.userId, userId, eq(topics.slug, slug)))
    .get()
  if (existing) return existing

  const inserted = db
    .insert(topics)
    .values({ userId, slug, label: slugToLabel(slug), color: colorForSlug(slug) })
    .returning()
    .get()
  if (!inserted) throw new Error('findOrCreateTopic: insert produced no row')
  return inserted
}

/** Sets (or elevates) `slug` as `itemId`'s manual topic override. Creates the topic if needed. */
export function setManualTopicOverride(
  db: DbOrTx,
  userId: number,
  itemId: number,
  slug: string,
): void {
  const topic = findOrCreateTopic(db, userId, slug)
  db.insert(itemTopics)
    .values({ itemId, topicId: topic.id, confidence: MANUAL_OVERRIDE_CONFIDENCE })
    .onConflictDoUpdate({
      target: [itemTopics.itemId, itemTopics.topicId],
      set: { confidence: MANUAL_OVERRIDE_CONFIDENCE },
    })
    .run()
}

/** Clears `itemId`'s manual override (if any), reverting its primary topic to the AI's own assignment. */
export function clearManualTopicOverride(db: DbOrTx, itemId: number): void {
  db.delete(itemTopics)
    .where(
      and(eq(itemTopics.itemId, itemId), eq(itemTopics.confidence, MANUAL_OVERRIDE_CONFIDENCE)),
    )
    .run()
}

/** The single-item form of `getPrimaryTopicsByItemIds`, for `GET /items/:id`. */
export function getPrimaryTopic(db: DbOrTx, itemId: number): PrimaryTopic | null {
  const row = db
    .select({
      slug: topics.slug,
      label: topics.label,
      color: topics.color,
      confidence: itemTopics.confidence,
    })
    .from(itemTopics)
    .innerJoin(topics, eq(topics.id, itemTopics.topicId))
    .where(eq(itemTopics.itemId, itemId))
    .orderBy(desc(itemTopics.confidence), desc(itemTopics.topicId))
    .limit(1)
    .get()
  if (!row) return null
  return {
    slug: row.slug,
    label: row.label,
    color: row.color ?? colorForSlug(row.slug),
    confidence: row.confidence,
  }
}

/**
 * Batched primary-topic lookup for a page of items (list endpoints) — one query via a window
 * function rather than N+1 per-item queries. Uses the raw sqlite connection directly (matching
 * this codebase's existing pattern for queries Drizzle's builder doesn't express cleanly — see
 * `src/app/api/v1/health/route.ts`).
 */
export function getPrimaryTopicsByItemIds(
  sqlite: Database.Database,
  itemIds: number[],
): Map<number, PrimaryTopic> {
  const result = new Map<number, PrimaryTopic>()
  if (itemIds.length === 0) return result

  const placeholders = itemIds.map(() => '?').join(',')
  const rows = sqlite
    .prepare<
      number[],
      { item_id: number; slug: string; label: string; color: string | null; confidence: number }
    >(
      `SELECT item_id, slug, label, color, confidence FROM (
         SELECT it.item_id AS item_id, t.slug AS slug, t.label AS label, t.color AS color,
                it.confidence AS confidence,
                ROW_NUMBER() OVER (PARTITION BY it.item_id ORDER BY it.confidence DESC, it.topic_id DESC) AS rn
         FROM item_topics it
         JOIN topics t ON t.id = it.topic_id
         WHERE it.item_id IN (${placeholders})
       ) WHERE rn = 1`,
    )
    .all(...itemIds)

  for (const row of rows) {
    result.set(row.item_id, {
      slug: row.slug,
      label: row.label,
      color: row.color ?? colorForSlug(row.slug),
      confidence: row.confidence,
    })
  }
  return result
}

/**
 * Item ids whose primary topic (see above) has one of the given slugs — backs `GET /items`'s
 * `topic=` filter (docs/API.md §3.3). A plain column-equality filter can't express "primary
 * topic," since an item can have more than one `item_topics` row; this re-derives the same
 * highest-confidence-wins definition used everywhere else via a scalar subquery per item.
 */
export function primaryTopicSlugCondition(slugs: string[]) {
  return sql`(
    SELECT t.slug FROM item_topics it
    JOIN topics t ON t.id = it.topic_id
    WHERE it.item_id = items.id
    ORDER BY it.confidence DESC, it.topic_id DESC
    LIMIT 1
  ) IN ${slugs}`
}

/** Item ids that have at least one of the given tag labels — backs `GET /items`'s `tag=` filter. */
export function hasAnyTagCondition(labels: string[]) {
  return sql`EXISTS (
    SELECT 1 FROM ${itemTags} it2
    JOIN ${tags} tg ON tg.id = it2.tag_id
    WHERE it2.item_id = items.id AND tg.label IN ${labels}
  )`
}

// Re-exported so callers that only need "some ordering helper" don't have to reach into
// drizzle-orm directly for these — kept here since they're only ever used alongside the above.
export { asc, desc, inArray }

/**
 * Tag assignment for `PATCH /api/v1/items/:id`'s `tags` field (docs/API.md §3.5 — full
 * replacement of the item's tag set, not an add/remove diff) and batched tag lookup for list
 * responses.
 */

import { eq, inArray } from 'drizzle-orm'
import type Database from 'better-sqlite3'
import { itemTags, tags } from '@/db/schema'
import { scopedTo } from '@/repositories/scoping'
import type { DbOrTx } from '@/services/db-types'

/** Manual tag edits are user-typed free text, not AI output — capped generously, not tightly. */
export const MAX_TAGS_PER_ITEM = 50

function findOrCreateTag(db: DbOrTx, userId: number, label: string): number {
  const existing = db
    .select({ id: tags.id })
    .from(tags)
    .where(scopedTo(tags.userId, userId, eq(tags.label, label)))
    .get()
  if (existing) return existing.id

  const inserted = db.insert(tags).values({ userId, label }).returning({ id: tags.id }).get()
  if (!inserted) throw new Error('findOrCreateTag: insert produced no row')
  return inserted.id
}

/** Replaces `itemId`'s entire tag set with `labels` (deduped, order-preserving-ish via a Set). */
export function replaceItemTags(
  db: DbOrTx,
  userId: number,
  itemId: number,
  labels: string[],
): void {
  const uniqueLabels = [
    ...new Set(labels.map((label) => label.trim()).filter((label) => label.length > 0)),
  ]
  const tagIds = uniqueLabels.map((label) => findOrCreateTag(db, userId, label))

  db.delete(itemTags).where(eq(itemTags.itemId, itemId)).run()
  for (const tagId of tagIds) {
    db.insert(itemTags).values({ itemId, tagId }).run()
  }
}

/** The single-item form of `getTagsByItemIds`, for `GET /items/:id`. */
export function getTagsForItem(db: DbOrTx, itemId: number): string[] {
  const rows = db
    .select({ label: tags.label })
    .from(itemTags)
    .innerJoin(tags, eq(tags.id, itemTags.tagId))
    .where(eq(itemTags.itemId, itemId))
    .all()
  return rows.map((row) => row.label)
}

/**
 * Batched tag lookup for a page of items (list endpoints) — one query rather than N+1. Uses the
 * raw connection directly since grouping labels into an array per item is awkward through the
 * query builder alone (see `topics.ts`'s header for why this codebase drops to raw SQL here).
 */
export function getTagsByItemIds(
  sqlite: Database.Database,
  itemIds: number[],
): Map<number, string[]> {
  const result = new Map<number, string[]>()
  if (itemIds.length === 0) return result

  const placeholders = itemIds.map(() => '?').join(',')
  const rows = sqlite
    .prepare<number[], { item_id: number; label: string }>(
      `SELECT it.item_id AS item_id, t.label AS label
       FROM item_tags it
       JOIN tags t ON t.id = it.tag_id
       WHERE it.item_id IN (${placeholders})
       ORDER BY t.label ASC`,
    )
    .all(...itemIds)

  for (const row of rows) {
    const existing = result.get(row.item_id)
    if (existing) existing.push(row.label)
    else result.set(row.item_id, [row.label])
  }
  return result
}

// Re-exported for callers building filter conditions alongside these helpers.
export { inArray }

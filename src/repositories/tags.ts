/**
 * Tag persistence — `tags` and `item_tags`. Find-or-create per label, then replace an item's
 * whole tag set in one go: a re-enrich should reflect the model's CURRENT tags, not accumulate
 * every tag it has ever proposed across retries.
 *
 * `setItemTags` inserts the new tag set BEFORE deleting whichever old ones are no longer wanted —
 * this is not just an optimization to skip re-churning unchanged tags. VERIFIED EMPIRICALLY
 * (reproduced with plain SQL against the untouched migration, no P7 code involved): the
 * `item_tags_fts_ad` trigger (drizzle/0000_init.sql) reconstructs the pre-delete `tags` string for
 * FTS5's delete-command as `trim(<remaining item_tags for this item> || ' ' || <the just-deleted
 * tag's label>)`. SQLite's `||` propagates `NULL` through the whole expression, so the instant a
 * delete removes an item's LAST remaining tag, "remaining item_tags" is `NULL` and the whole
 * reconstructed value collapses to `NULL` — which does not match what was actually indexed
 * earlier (the real label string), corrupting the external-content FTS5 index ("database disk
 * image is malformed" on the next write). A delete-everything-then-reinsert order hits this on
 * every second-or-later `setItemTags` call, since it always passes through "zero tags" on the way
 * to the new set. Inserting first means `item_tags` never drops to zero rows for an item that's
 * about to have tags again (enrichment's tag list is never empty — TAG_COUNT_MIN=3), so the buggy
 * NULL-collapse path in that trigger is never reached from here. This does not fix the trigger
 * itself — a future write path that genuinely removes an item's last tag (not this function) would
 * still hit it; see the P7 phase report for the full writeup.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { itemTags, tags } from '@/db/schema'
import type { DbClient } from '@/db/client'
import { scopedTo } from './scoping'

function getOrCreateTag(db: DbClient, userId: number, label: string): number {
  const existing = db
    .select({ id: tags.id })
    .from(tags)
    .where(scopedTo(tags.userId, userId, eq(tags.label, label)))
    .get()
  if (existing) return existing.id
  return db.insert(tags).values({ userId, label }).returning({ id: tags.id }).get().id
}

export function setItemTags(
  db: DbClient,
  userId: number,
  itemId: number,
  labels: readonly string[],
): void {
  const currentTagIds = new Set(
    db
      .select({ tagId: itemTags.tagId })
      .from(itemTags)
      .where(eq(itemTags.itemId, itemId))
      .all()
      .map((r) => r.tagId),
  )
  const newTagIds = new Set(labels.map((label) => getOrCreateTag(db, userId, label)))

  const toAdd = [...newTagIds].filter((id) => !currentTagIds.has(id))
  const toRemove = [...currentTagIds].filter((id) => !newTagIds.has(id))

  // Add first, remove second — see file header for why this order matters, not just for
  // avoiding redundant churn on tags that didn't change.
  for (const tagId of toAdd) {
    db.insert(itemTags).values({ itemId, tagId }).run()
  }
  if (toRemove.length > 0) {
    db.delete(itemTags)
      .where(and(eq(itemTags.itemId, itemId), inArray(itemTags.tagId, toRemove)))
      .run()
  }
}

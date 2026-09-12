/**
 * Tag persistence — `tags` and `item_tags`. Find-or-create per label, then replace an item's
 * whole tag set in one go: a re-enrich should reflect the model's CURRENT tags, not accumulate
 * every tag it has ever proposed across retries.
 */
import { eq } from 'drizzle-orm'
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

export function setItemTags(db: DbClient, userId: number, itemId: number, labels: readonly string[]): void {
  db.delete(itemTags).where(eq(itemTags.itemId, itemId)).run()
  for (const label of labels) {
    const tagId = getOrCreateTag(db, userId, label)
    db.insert(itemTags).values({ itemId, tagId }).run()
  }
}

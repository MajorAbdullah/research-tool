/**
 * Topic persistence — `topics` and `item_topics`. `EnrichmentResult.topic` (contracts.ts) is a
 * single free-text label per item; P3's `assignTopic` (src/lib/ai/topic-assignment.ts) decides
 * whether that label means an existing topic or a new one, but never creates or persists
 * anything itself (P3 has no DB access) — that's this file's job, called from the `enrich` stage
 * handler (P7.3).
 */
import { eq } from 'drizzle-orm'
import { itemTopics, topics } from '@/db/schema'
import type { DbClient } from '@/db/client'
import { scopedTo } from './scoping'
import type { ExistingTopic } from '@/lib/ai'

export type TopicRow = typeof topics.$inferSelect

export function listTopicsForUser(db: DbClient, userId: number): ExistingTopic[] {
  return db
    .select({ id: topics.id, label: topics.label })
    .from(topics)
    .where(scopedTo(topics.userId, userId))
    .all()
}

function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base.length > 0 ? base : 'topic'
}

/**
 * Creates a new topic for `label`, disambiguating the slug on collision (two different labels
 * that happen to normalize to the same slug, e.g. "RAG" and "R.A.G." — rare, but `topics`' unique
 * `(user_id, slug)` index would otherwise throw). The check-then-insert below isn't a race
 * condition in practice: better-sqlite3 is synchronous and this app makes no `await` between the
 * read and the write, so nothing else can interleave within this single Node.js process.
 */
export function createTopic(db: DbClient, userId: number, label: string): TopicRow {
  const baseSlug = slugify(label)
  const attempts = 5
  for (let attempt = 0; attempt < attempts; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`
    const collision = db
      .select({ id: topics.id })
      .from(topics)
      .where(scopedTo(topics.userId, userId, eq(topics.slug, slug)))
      .get()
    if (collision) continue
    return db.insert(topics).values({ userId, slug, label }).returning().get()
  }
  throw new Error(`createTopic: could not find a free slug for label ${JSON.stringify(label)}`)
}

/**
 * Replaces whichever topic (if any) `itemId` was previously assigned with exactly one new
 * assignment — `EnrichmentResult.topic` is singular, so an item has at most one topic at a time;
 * a re-enrich reassigns rather than accumulates.
 */
export function setItemTopic(
  db: DbClient,
  itemId: number,
  topicId: number,
  confidence: number,
): void {
  db.delete(itemTopics).where(eq(itemTopics.itemId, itemId)).run()
  db.insert(itemTopics).values({ itemId, topicId, confidence }).run()
}

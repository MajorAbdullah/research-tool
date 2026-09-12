/**
 * Item persistence — the `items` table. Every function takes the shared Drizzle `DbClient` (see
 * src/db/client.ts) as its first argument, dependency-injected so tests can pass a
 * `drizzle()`-wrapped scratch database (tests/helpers/db.ts's `makeTestDb()`, wrapped the same
 * way `src/db/client.ts` wraps the real connection) instead of the app's configured database.
 *
 * `getItemById` is deliberately UNSCOPED — see its own doc comment. Every other lookup that needs
 * a `userId` filter goes through `scopedTo` (src/repositories/scoping.ts), per CLAUDE.md's
 * non-negotiable.
 */
import { eq } from 'drizzle-orm'
import { items } from '@/db/schema'
import type { DbClient } from '@/db/client'
import { scopedTo } from './scoping'
import { ItemStatus } from '@/types/contracts'
import type { ExtractionTier, ItemKind, SourceSurface, UtcMillis } from '@/types/contracts'

export type ItemRow = typeof items.$inferSelect

export interface NewItemInput {
  userId: number
  url: string
  canonicalUrl: string
  urlHash: string
  kind: ItemKind
  sourceSurface: SourceSurface
  note?: string
}

export function findItemByUrlHash(db: DbClient, userId: number, urlHash: string): ItemRow | undefined {
  return db
    .select()
    .from(items)
    .where(scopedTo(items.userId, userId, eq(items.urlHash, urlHash)))
    .get()
}

export function insertItem(db: DbClient, input: NewItemInput): ItemRow {
  return db
    .insert(items)
    .values({
      userId: input.userId,
      url: input.url,
      canonicalUrl: input.canonicalUrl,
      urlHash: input.urlHash,
      kind: input.kind,
      sourceSurface: input.sourceSurface,
      note: input.note,
    })
    .returning()
    .get()
}

export function touchItemUpdatedAt(db: DbClient, id: number): void {
  db.update(items).set({ updatedAt: Date.now() }).where(eq(items.id, id)).run()
}

/**
 * Unscoped by design: job payloads (contracts.ts's `JobPayload` union) carry only `itemId`, never
 * `userId` — a worker-process job isn't a user-facing request with a session to scope by. Every
 * stage handler uses this to discover WHICH user an item belongs to, then threads that `userId`
 * through every subsequent scoped lookup (existing topics, chunk_vec kNN candidates, ...).
 * Anything reachable from an authenticated HTTP request (P8) should prefer `getItemByIdScoped`.
 */
export function getItemById(db: DbClient, id: number): ItemRow | undefined {
  return db.select().from(items).where(eq(items.id, id)).get()
}

export function getItemByIdScoped(db: DbClient, userId: number, id: number): ItemRow | undefined {
  return db
    .select()
    .from(items)
    .where(scopedTo(items.userId, userId, eq(items.id, id)))
    .get()
}

export interface ExtractionUpdate {
  contentText: string
  extractionTier: ExtractionTier
  title?: string
  author?: string
  publishedAt?: UtcMillis
  thumbnailUrl?: string
  kindFields?: Record<string, unknown>
  rawPayload?: unknown
}

/**
 * A field left `undefined` on `patch` leaves that column untouched (Drizzle's `.set()` drops
 * `undefined`-valued keys from the generated UPDATE — verified against this project's exact
 * drizzle-orm/better-sqlite3 versions) rather than nulling it out. A re-extraction that finds
 * less than a previous attempt did (e.g. a retry lands on a lower ladder rung) therefore keeps
 * whatever richer value was already stored instead of erasing it.
 */
export function updateExtractionResult(db: DbClient, id: number, patch: ExtractionUpdate): void {
  db.update(items)
    .set({
      contentText: patch.contentText,
      extractionTier: patch.extractionTier,
      title: patch.title,
      author: patch.author,
      publishedAt: patch.publishedAt,
      thumbnailUrl: patch.thumbnailUrl,
      kindFields: patch.kindFields,
      rawPayload: patch.rawPayload,
      updatedAt: Date.now(),
    })
    .where(eq(items.id, id))
    .run()
}

export interface EnrichmentUpdate {
  summaryTldr: string
  summaryBullets: string[]
  kindFields?: Record<string, unknown>
}

export function updateEnrichmentResult(db: DbClient, id: number, patch: EnrichmentUpdate): void {
  db.update(items)
    .set({
      summaryTldr: patch.summaryTldr,
      summaryBullets: patch.summaryBullets,
      kindFields: patch.kindFields,
      updatedAt: Date.now(),
    })
    .where(eq(items.id, id))
    .run()
}

export function setItemStatus(db: DbClient, id: number, status: ItemStatus): void {
  db.update(items).set({ status, updatedAt: Date.now() }).where(eq(items.id, id)).run()
}

/** Permanent failure (P7.7): CLAUDE.md/the phase brief require this to be the only way an item
 *  reaches `failed` — always paired with a human-readable reason, never silent. */
export function markItemFailed(db: DbClient, id: number, reason: string): void {
  db.update(items)
    .set({ status: ItemStatus.Failed, failureReason: reason, updatedAt: Date.now() })
    .where(eq(items.id, id))
    .run()
}

/** Used by `src/worker/retry.ts`: clears a previous failure and puts the item back in the
 *  "captured, not yet picked up" state before enqueuing the requested stage's job. */
export function requeueItemForRetry(db: DbClient, id: number): void {
  db.update(items)
    .set({ status: ItemStatus.Queued, failureReason: null, updatedAt: Date.now() })
    .where(eq(items.id, id))
    .run()
}

interface FtsRowidRow {
  rowid: number
}

/**
 * Defensive check (P7.6, `index` stage) that `items_fts` — a trigger-maintained external-content
 * index, not a Drizzle-declared table (see src/db/schema.ts's header) — actually has a row for
 * this item. FTS5 sync itself is 100% trigger-driven (drizzle/0000_init.sql); this never fixes
 * anything, it only turns a broken trigger chain into a loud, caught-immediately error instead of
 * an item that silently never turns up in search. Drops to the raw connection (`db.$client`)
 * because `items_fts` has no Drizzle schema entry to query through.
 */
export function assertFtsInSync(db: DbClient, itemId: number): void {
  const row = db.$client
    .prepare<[number], FtsRowidRow>('select rowid from items_fts where rowid = ?')
    .get(itemId)
  if (!row) {
    throw new Error(
      `assertFtsInSync: items_fts has no row for item ${itemId} — the FTS5 sync trigger chain is broken`,
    )
  }
}

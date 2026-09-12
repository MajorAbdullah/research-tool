/**
 * `POST /api/v1/capture`'s business logic (docs/API.md §3.1) — the most important service in
 * this phase. The route handler only parses/authorizes/validates; every decision described in
 * the contract (dedupe, the upgrade-path re-trigger, what gets enqueued) lives here so it can be
 * exercised directly from `tests/integration/capture.test.ts` without going through HTTP.
 *
 * Concurrency note: this function is entirely synchronous (no `await` anywhere in its body, on
 * purpose) and better-sqlite3 is a synchronous, single-connection driver — so two "concurrent"
 * `POST /api/v1/capture` requests can never interleave partway through this function; Node's
 * event loop runs one to completion before the other's body starts. That is what actually makes
 * "concurrent posts don't duplicate" (the plan's 8.1 acceptance criterion) hold, not a database
 * lock — the `items_user_url_hash_unique` index is kept anyway as a hard backstop that would
 * surface loudly (a thrown constraint error, not a silent duplicate) if that assumption ever
 * stopped being true (e.g. a future multi-process worker).
 */

import { eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { items } from '@/db/schema'
import { scopedTo } from '@/repositories/scoping'
import { getJobQueue } from '@/lib/queue'
import { ExtractionTier, ItemStatus, JobName } from '@/types/contracts'
import type {
  ClientCapture,
  ExtractJobPayload,
  ItemStatus as ItemStatusType,
  SourceSurface,
} from '@/types/contracts'
import {
  hasAnyHint,
  mergeClientCaptureIntoRawPayload,
  pickHint,
  readStoredClientCapture,
} from '@/services/client-capture'
import { toItemId } from '@/services/ids'
import { canonicalizeUrl, guessKind, hashUrl } from '@/services/url'

export interface CaptureInput {
  url: string
  title?: string
  note?: string
  html?: string
  transcript?: string
  caption?: string
  surface: SourceSurface
}

export interface CaptureResult {
  id: string
  status: ItemStatusType
  duplicate: boolean
}

function enqueueExtract(itemId: number, hint: ClientCapture): void {
  const payload: ExtractJobPayload = hasAnyHint(hint)
    ? { name: JobName.Extract, itemId, hint }
    : { name: JobName.Extract, itemId }
  getJobQueue().enqueue(payload)
}

/**
 * Creates (or updates) the item for `input` and enqueues whatever pipeline work follows,
 * returning immediately — this function does no network I/O and awaits nothing, matching
 * docs/API.md §3.1's "responds in under 300ms, always" contract structurally, not just by being
 * fast in practice.
 */
export function captureLink(userId: number, input: CaptureInput): CaptureResult {
  const db = getDb()
  const canonicalUrl = canonicalizeUrl(input.url)
  const urlHash = hashUrl(canonicalUrl)
  const freshHint = pickHint(input)
  const now = Date.now()

  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(items)
      .where(scopedTo(items.userId, userId, eq(items.urlHash, urlHash)))
      .get()

    if (!existing) {
      const inserted = tx
        .insert(items)
        .values({
          userId,
          url: input.url,
          canonicalUrl,
          urlHash,
          kind: guessKind(canonicalUrl),
          status: ItemStatus.Queued,
          title: input.title ?? null,
          note: input.note ?? null,
          sourceSurface: input.surface,
          rawPayload: hasAnyHint(freshHint) ? { clientCapture: freshHint } : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get()
      if (!inserted) throw new Error('captureLink: insert produced no row')

      enqueueExtract(inserted.id, freshHint)
      return { id: toItemId(inserted.id), status: ItemStatus.Queued, duplicate: false }
    }

    // Duplicate url_hash. A bare re-POST just touches updated_at (docs/API.md §3.1). But if this
    // request brings fresh html/transcript/caption AND the stored item hasn't already reached the
    // best possible tier, that's the "re-shared from the extension to upgrade past metadata_only"
    // flow the whole endpoint exists for — store the fresher content and re-run extraction.
    const canImprove = existing.extractionTier !== ExtractionTier.Full && hasAnyHint(freshHint)

    if (!canImprove) {
      tx.update(items).set({ updatedAt: now }).where(eq(items.id, existing.id)).run()
      return { id: toItemId(existing.id), status: existing.status, duplicate: true }
    }

    const mergedRawPayload = mergeClientCaptureIntoRawPayload(existing.rawPayload, freshHint)
    const mergedHint = readStoredClientCapture(mergedRawPayload)

    tx.update(items)
      .set({ status: ItemStatus.Queued, rawPayload: mergedRawPayload, updatedAt: now })
      .where(eq(items.id, existing.id))
      .run()

    enqueueExtract(existing.id, mergedHint)
    return { id: toItemId(existing.id), status: ItemStatus.Queued, duplicate: true }
  })
}

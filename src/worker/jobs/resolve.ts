/**
 * `resolve` (P7.1) — the pipeline's first stage: canonicalizes the URL, classifies its kind,
 * dedupes on `(user_id, url_hash)`, and either creates a new `items` row or, for a duplicate, just
 * touches `updated_at` (docs/API.md §3.1 documents the full capture-endpoint contract this
 * mirrors, including the "duplicate arrives with a fresh hint that could upgrade it past its
 * current tier" case).
 *
 * The only stage with no `itemId` yet (contracts.ts's `ResolveJobPayload`) — there is no item row
 * to mark `processing`/`failed`, so this file does NOT go through `runStage`
 * (src/worker/jobs/shared.ts); a resolve failure just lets queue.ts's own retry/dead-letter apply
 * to the job, with nothing left half-created either way.
 */
import { createHash } from 'node:crypto'
import { JobName } from '@/types/contracts'
import type { ResolveJobPayload } from '@/types/contracts'
import { canonicalizeUrlSync, classifyKind } from '@/lib/extractors'
import type { JobQueue } from '@/lib/queue'
import type { DbClient } from '@/db/client'
import { findItemByUrlHash, insertItem, touchItemUpdatedAt } from '@/repositories/items'
import { getSoleUserId } from '@/repositories/users'
import type { JobHandler } from '../registry'

function hashCanonicalUrl(canonicalUrl: string): string {
  return createHash('sha256').update(canonicalUrl).digest('hex')
}

export interface ResolveHandlerDeps {
  db: DbClient
  jobQueue: JobQueue
}

export function createResolveHandler(deps: ResolveHandlerDeps): JobHandler<ResolveJobPayload> {
  return async (payload) => {
    const canonicalUrl = canonicalizeUrlSync(payload.url)
    const urlHash = hashCanonicalUrl(canonicalUrl)
    const kind = classifyKind(canonicalUrl)
    const userId = getSoleUserId(deps.db)

    const existing = findItemByUrlHash(deps.db, userId, urlHash)
    if (existing) {
      touchItemUpdatedAt(deps.db, existing.id)
      // A fresh client capture on an item that hasn't already reached the best possible tier is
      // worth re-running extraction for (docs/API.md §3.1's "re-shared from the extension to
      // upgrade past metadata_only" flow); a bare duplicate re-POST with nothing new isn't.
      if (payload.hint && existing.extractionTier !== 'full') {
        deps.jobQueue.enqueue({ name: JobName.Extract, itemId: existing.id, hint: payload.hint })
      }
      return
    }

    const created = insertItem(deps.db, {
      userId,
      url: payload.url,
      canonicalUrl,
      urlHash,
      kind,
      sourceSurface: payload.surface,
      note: payload.note,
    })
    deps.jobQueue.enqueue({ name: JobName.Extract, itemId: created.id, hint: payload.hint })
  }
}

/**
 * Shared plumbing every stage handler (except `resolve`, which has no item yet) runs through:
 * turning a caught error into the right combination of "mark the item failed" and/or "let
 * queue.ts's own retry/backoff/dead-letter run" — see CLAUDE.md's non-negotiables and the phase
 * brief's hard requirement that a permanent failure always sets `items.status='failed'` with a
 * readable reason, and that an item is never left stuck in `processing`.
 *
 * Two kinds of "permanent" are distinguished:
 *
 * 1. STRUCTURALLY permanent — the error itself says so (an `ExtractionError` with
 *    `retryable:false`: a 404, an unsupported URL, an invalid PDF). Recognized on the very first
 *    attempt; there's no reason to wait for retries to exhaust something that will never succeed.
 * 2. EVENTUALLY permanent — a nominally-retryable error (network blip, 429, 503) that queue.ts's
 *    own backoff has already retried `DEFAULT_MAX_ATTEMPTS` times with no success. `JobPayload`
 *    (contracts.ts, frozen) carries an `itemId` but never a `jobId`, and `registry.ts`'s
 *    `JobHandler` is called with only the payload — so a handler has no direct way to know its
 *    own attempt count. `isLastAttempt` recovers it by reading the one 'active' job row for this
 *    (stage, itemId): safe because this app runs one worker process at a small fixed
 *    concurrency, so at most one job per (stage, itemId) is ever active at a time.
 */
import type Database from 'better-sqlite3'
import { JobName, ItemStatus } from '@/types/contracts'
import { ExtractionError } from '@/lib/extractors'
import { DEFAULT_MAX_ATTEMPTS } from '@/lib/queue'
import type { DbClient } from '@/db/client'
import { markItemFailed, setItemStatus } from '@/repositories/items'
import { logger } from '@/lib/logger'

interface ActiveAttemptRow {
  attempts: number
}

/**
 * How many times the currently-active job for `(stage, itemId)` has been attempted (1 on its
 * first run — `claimNext()` increments `attempts` as part of the same atomic claim, before the
 * handler ever runs). Falls back to `1` (i.e. "treat as a first attempt, don't give up early") if
 * no matching active row is found — this is a best-effort peek, not the source of truth, and that
 * fallback is the safe direction for it to be wrong in.
 */
export function currentAttempt(sqlite: Database.Database, stage: JobName, itemId: number): number {
  const row = sqlite
    .prepare<[string, number], ActiveAttemptRow>(
      `select attempts from jobs
       where state = 'active' and name = ? and json_extract(payload, '$.itemId') = ?
       order by id desc limit 1`,
    )
    .get(stage, itemId)
  return row?.attempts ?? 1
}

export function isLastAttempt(
  sqlite: Database.Database,
  stage: JobName,
  itemId: number,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): boolean {
  return currentAttempt(sqlite, stage, itemId) >= maxAttempts
}

/** Structurally permanent — see file header, case 1. */
function isStructurallyPermanent(err: unknown): boolean {
  return err instanceof ExtractionError && !err.retryable
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export interface RunStageOptions {
  db: DbClient
  stage: JobName
  itemId: number
}

/**
 * Runs one stage's body, applying the failure-classification rules above. Also sets
 * `items.status='processing'` up front — "a stage is actively running" (contracts.ts's own
 * `ItemStatus` doc comments) is true from the moment a stage picks the item up, not just once it
 * succeeds.
 */
export async function runStage(options: RunStageOptions, fn: () => Promise<void>): Promise<void> {
  setItemStatus(options.db, options.itemId, ItemStatus.Processing)
  try {
    await fn()
  } catch (err) {
    const sqlite = options.db.$client

    if (isStructurallyPermanent(err)) {
      const reason = messageOf(err)
      markItemFailed(options.db, options.itemId, reason)
      logger.warn(
        { stage: options.stage, itemId: options.itemId, reason },
        'stage: permanent failure — item marked failed',
      )
      return // nothing left to retry — the job itself completed the work of recording this
    }

    if (isLastAttempt(sqlite, options.stage, options.itemId)) {
      const reason = `${messageOf(err)} (gave up after ${DEFAULT_MAX_ATTEMPTS} attempts)`
      markItemFailed(options.db, options.itemId, reason)
      logger.warn(
        { stage: options.stage, itemId: options.itemId, reason },
        'stage: giving up after max attempts — item marked failed',
      )
    }

    throw err instanceof Error ? err : new Error(messageOf(err))
  }
}

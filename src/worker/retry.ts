/**
 * "Retry from stage" (P7.7/7.8) — the entry point `POST /api/v1/items/:id/retry` (P8, docs/API.md
 * §3.7) calls to re-run one named stage for an existing item. Enqueue-only, same latency contract
 * as capture: this never runs stage work inline, it only validates, updates bookkeeping, and
 * enqueues.
 *
 * `resolve` is deliberately NOT a valid target here, even though docs/API.md §3.7 describes
 * `JobStage` (the wire type) as having six values, mirroring `JobName` exactly. `ResolveJobPayload`
 * (contracts.ts, frozen) has no `itemId` at all — resolving IS creating the item, so "retry
 * resolve for an item that already exists" has no coherent meaning under the frozen job contract.
 * P8's own request validation should reject it too; this function refuses it defensively either
 * way, via the `invalid_stage` outcome.
 */
import { JobName } from '@/types/contracts'
import type { ClientCapture, JobPayload } from '@/types/contracts'
import type { JobQueue } from '@/lib/queue'
import type { DbClient } from '@/db/client'
import { getItemByIdScoped, requeueItemForRetry } from '@/repositories/items'

export type RetryableStage = Exclude<JobName, typeof JobName.Resolve>

export type RetryOutcome =
  | { ok: true; itemId: number; stage: RetryableStage }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid_stage' }
  | { ok: false; reason: 'conflict' }

export interface RetryParams {
  userId: number
  itemId: number
  stage: JobName
  hint?: ClientCapture
}

function isRetryableStage(stage: JobName): stage is RetryableStage {
  return stage !== JobName.Resolve
}

function buildPayload(stage: RetryableStage, itemId: number, hint?: ClientCapture): JobPayload {
  switch (stage) {
    case JobName.Extract:
      return { name: JobName.Extract, itemId, hint }
    case JobName.Enrich:
      return { name: JobName.Enrich, itemId }
    case JobName.Embed:
      return { name: JobName.Embed, itemId }
    case JobName.Relate:
      return { name: JobName.Relate, itemId }
    case JobName.Index:
      return { name: JobName.Index, itemId }
    default: {
      const exhaustive: never = stage
      throw new Error(`retry: unhandled stage ${JSON.stringify(exhaustive)}`)
    }
  }
}

interface PendingJobRow {
  found: number
}

/** Backs the `409 CONFLICT` case in docs/API.md §3.7: "A job for this item at this stage is
 *  already pending or running." */
function hasPendingJob(db: DbClient, stage: JobName, itemId: number): boolean {
  const row = db.$client
    .prepare<[string, number], PendingJobRow>(
      `select 1 as found from jobs
       where name = ? and state in ('queued','active') and json_extract(payload, '$.itemId') = ?
       limit 1`,
    )
    .get(stage, itemId)
  return row !== undefined
}

export function retryItemFromStage(
  db: DbClient,
  jobQueue: JobQueue,
  params: RetryParams,
): RetryOutcome {
  if (!isRetryableStage(params.stage)) {
    return { ok: false, reason: 'invalid_stage' }
  }

  const item = getItemByIdScoped(db, params.userId, params.itemId)
  if (!item) {
    return { ok: false, reason: 'not_found' }
  }

  if (hasPendingJob(db, params.stage, params.itemId)) {
    return { ok: false, reason: 'conflict' }
  }

  requeueItemForRetry(db, params.itemId)
  jobQueue.enqueue(buildPayload(params.stage, params.itemId, params.hint))

  return { ok: true, itemId: params.itemId, stage: params.stage }
}

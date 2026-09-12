import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/db/schema'
import { JobName } from '@/types/contracts'
import { createJobQueue, type JobQueue } from '@/lib/queue'
import { retryItemFromStage } from '@/worker/retry'
import { getItemById } from '@/repositories/items'
import { makeTestDb, type TestDb } from '../../helpers/db'
import { makeUser, makeItem } from '../../helpers/factories'

function wrap(rawDb: TestDb) {
  return drizzle(rawDb, { schema })
}

describe('retryItemFromStage', () => {
  let rawDb: TestDb
  let db: ReturnType<typeof wrap>
  let jobQueue: JobQueue

  beforeEach(() => {
    rawDb = makeTestDb()
    makeUser(rawDb, 1)
    makeUser(rawDb, 2)
    db = wrap(rawDb)
    jobQueue = createJobQueue(rawDb)
  })

  it('requeues the item and enqueues only the requested stage', async () => {
    const itemId = makeItem(rawDb, {
      userId: 1,
      status: 'failed',
      extractionTier: 'partial',
    })
    db.$client.prepare("update items set failure_reason = 'boom' where id = ?").run(itemId)

    const outcome = retryItemFromStage(db, jobQueue, {
      userId: 1,
      itemId,
      stage: JobName.Enrich,
    })

    expect(outcome).toEqual({ ok: true, itemId, stage: 'enrich' })
    const item = getItemById(db, itemId)
    expect(item?.status).toBe('queued')
    expect(item?.failureReason).toBeNull()

    const jobs = db.$client.prepare('select name from jobs').all() as Array<{ name: string }>
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.name).toBe('enrich')
  })

  it('forwards a fresh hint into a re-run of extract', async () => {
    const itemId = makeItem(rawDb, { userId: 1, extractionTier: 'metadata_only' })

    retryItemFromStage(db, jobQueue, {
      userId: 1,
      itemId,
      stage: JobName.Extract,
      hint: { html: '<html>fresh</html>' },
    })

    const job = jobQueue.claimNext()
    expect(job?.payload).toEqual({
      name: 'extract',
      itemId,
      hint: { html: '<html>fresh</html>' },
    })
  })

  it('rejects `resolve` as a retry target — it has no itemId under the frozen job contract', async () => {
    const itemId = makeItem(rawDb, { userId: 1 })
    const outcome = retryItemFromStage(db, jobQueue, { userId: 1, itemId, stage: JobName.Resolve })
    expect(outcome).toEqual({ ok: false, reason: 'invalid_stage' })
    expect(jobQueue.claimNext()).toBeNull()
  })

  it('returns not_found for a nonexistent item', () => {
    const outcome = retryItemFromStage(db, jobQueue, {
      userId: 1,
      itemId: 999_999,
      stage: JobName.Embed,
    })
    expect(outcome).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns not_found for an item that belongs to a different user', () => {
    const itemId = makeItem(rawDb, { userId: 2 })
    const outcome = retryItemFromStage(db, jobQueue, { userId: 1, itemId, stage: JobName.Embed })
    expect(outcome).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns conflict when a job for that stage is already queued or active', () => {
    const itemId = makeItem(rawDb, { userId: 1 })
    jobQueue.enqueue({ name: JobName.Embed, itemId })

    const outcome = retryItemFromStage(db, jobQueue, { userId: 1, itemId, stage: JobName.Embed })
    expect(outcome).toEqual({ ok: false, reason: 'conflict' })

    // no second job was enqueued
    const jobs = db.$client.prepare('select count(*) c from jobs').get() as { c: number }
    expect(jobs.c).toBe(1)
  })

  it('a conflict on one stage does not block retrying a different stage', () => {
    const itemId = makeItem(rawDb, { userId: 1 })
    jobQueue.enqueue({ name: JobName.Embed, itemId })

    const outcome = retryItemFromStage(db, jobQueue, { userId: 1, itemId, stage: JobName.Enrich })
    expect(outcome.ok).toBe(true)
  })
})

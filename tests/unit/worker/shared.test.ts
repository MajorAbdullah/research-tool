import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/db/schema'
import { JobName } from '@/types/contracts'
import { DEFAULT_MAX_ATTEMPTS } from '@/lib/queue'
import { ExtractionError } from '@/lib/extractors'
import { runStage, isLastAttempt, currentAttempt } from '@/worker/jobs/shared'
import { getItemById } from '@/repositories/items'
import { makeTestDb, type TestDb } from '../../helpers/db'
import { makeUser, makeItem } from '../../helpers/factories'

function wrap(rawDb: TestDb) {
  return drizzle(rawDb, { schema })
}

/** Inserts a jobs row directly, bypassing the real queue — lets tests control `attempts`
 *  precisely without claiming a job five separate times. */
function insertActiveJob(rawDb: TestDb, stage: string, itemId: number, attempts: number): void {
  rawDb
    .prepare(`insert into jobs (name, payload, state, attempts) values (?, ?, 'active', ?)`)
    .run(stage, JSON.stringify({ name: stage, itemId }), attempts)
}

describe('currentAttempt / isLastAttempt', () => {
  let rawDb: TestDb
  beforeEach(() => {
    rawDb = makeTestDb()
    makeUser(rawDb, 1)
  })

  it('defaults to attempt 1 when no active job row matches', () => {
    expect(currentAttempt(rawDb, JobName.Extract, 999)).toBe(1)
    expect(isLastAttempt(rawDb, JobName.Extract, 999)).toBe(false)
  })

  it('reads the attempts count off the matching active job row', () => {
    const itemId = makeItem(rawDb, { id: 42 })
    insertActiveJob(rawDb, 'extract', itemId, 3)
    expect(currentAttempt(rawDb, JobName.Extract, itemId)).toBe(3)
    expect(isLastAttempt(rawDb, JobName.Extract, itemId)).toBe(false)
  })

  it('does not confuse itemId 4 with itemId 42 (no substring false-positive)', () => {
    const smallId = makeItem(rawDb, { id: 4 })
    const bigId = makeItem(rawDb, { id: 42 })
    insertActiveJob(rawDb, 'extract', bigId, 5)
    expect(currentAttempt(rawDb, JobName.Extract, smallId)).toBe(1)
    expect(currentAttempt(rawDb, JobName.Extract, bigId)).toBe(5)
  })

  it('is the last attempt once attempts reaches DEFAULT_MAX_ATTEMPTS', () => {
    const itemId = makeItem(rawDb, { id: 7 })
    insertActiveJob(rawDb, 'enrich', itemId, DEFAULT_MAX_ATTEMPTS)
    expect(isLastAttempt(rawDb, JobName.Enrich, itemId)).toBe(true)
  })

  it('only matches active jobs for the given stage, not other stages on the same item', () => {
    const itemId = makeItem(rawDb, { id: 8 })
    insertActiveJob(rawDb, 'enrich', itemId, DEFAULT_MAX_ATTEMPTS)
    expect(isLastAttempt(rawDb, JobName.Embed, itemId)).toBe(false)
  })
})

describe('runStage', () => {
  let rawDb: TestDb
  let db: ReturnType<typeof wrap>
  let itemId: number

  beforeEach(() => {
    rawDb = makeTestDb()
    makeUser(rawDb, 1)
    db = wrap(rawDb)
    itemId = makeItem(rawDb, { id: 100, status: 'queued' })
  })

  it('sets the item to processing before running the body', async () => {
    let statusDuringRun: string | undefined
    await runStage({ db, stage: JobName.Extract, itemId }, async () => {
      statusDuringRun = getItemById(db, itemId)?.status
    })
    expect(statusDuringRun).toBe('processing')
  })

  it('lets a successful body complete without touching status further', async () => {
    await expect(
      runStage({ db, stage: JobName.Extract, itemId }, async () => {
        /* success */
      }),
    ).resolves.toBeUndefined()
    expect(getItemById(db, itemId)?.status).toBe('processing')
    expect(getItemById(db, itemId)?.failureReason).toBeNull()
  })

  it('marks the item failed (and does NOT rethrow) for a structurally permanent error', async () => {
    await expect(
      runStage({ db, stage: JobName.Extract, itemId }, async () => {
        throw new ExtractionError('not_found', 'repo does not exist')
      }),
    ).resolves.toBeUndefined()

    const item = getItemById(db, itemId)
    expect(item?.status).toBe('failed')
    expect(item?.failureReason).toBe('repo does not exist')
  })

  it('rethrows a retryable error without marking the item failed when retries remain', async () => {
    await expect(
      runStage({ db, stage: JobName.Extract, itemId }, async () => {
        throw new ExtractionError('network_error', 'transient blip')
      }),
    ).rejects.toThrow('transient blip')

    const item = getItemById(db, itemId)
    expect(item?.status).toBe('processing')
    expect(item?.failureReason).toBeNull()
  })

  it('marks the item failed AND rethrows once the queue has exhausted its own retries', async () => {
    insertActiveJob(rawDb, 'extract', itemId, DEFAULT_MAX_ATTEMPTS)

    await expect(
      runStage({ db, stage: JobName.Extract, itemId }, async () => {
        throw new Error('still failing')
      }),
    ).rejects.toThrow('still failing')

    const item = getItemById(db, itemId)
    expect(item?.status).toBe('failed')
    expect(item?.failureReason).toContain('still failing')
    expect(item?.failureReason).toContain(`${DEFAULT_MAX_ATTEMPTS}`)
  })

  it('treats a plain (non-ExtractionError) error as retryable, not structurally permanent', async () => {
    await expect(
      runStage({ db, stage: JobName.Extract, itemId }, async () => {
        throw new Error('some bug')
      }),
    ).rejects.toThrow('some bug')

    expect(getItemById(db, itemId)?.status).toBe('processing')
  })
})

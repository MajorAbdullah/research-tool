import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import {
  computeBackoffMs,
  createJobQueue,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_DELAY_MS,
  type JobQueue,
} from '@/lib/queue'
import { JobName } from '@/types/contracts'
import type { JobPayload } from '@/types/contracts'
import { createScratchDb } from '../test-helpers/scratch-db'

describe('JobQueue', () => {
  let sqlite: Database.Database
  let queue: JobQueue

  beforeEach(() => {
    sqlite = createScratchDb()
    queue = createJobQueue(sqlite)
  })

  it('enqueue stores a job as queued with zero attempts, and claimNext round-trips the payload', () => {
    const payload: JobPayload = { name: JobName.Resolve, url: 'https://example.com', surface: 'web' }
    const enqueued = queue.enqueue(payload)
    expect(enqueued.state).toBe('queued')
    expect(enqueued.attempts).toBe(0)

    const claimed = queue.claimNext()
    expect(claimed).not.toBeNull()
    expect(claimed?.id).toBe(enqueued.id)
    expect(claimed?.payload).toEqual(payload)
    expect(claimed?.state).toBe('active')
    expect(claimed?.attempts).toBe(1) // claim itself increments attempts
  })

  it('claimNext returns null when the queue is empty', () => {
    expect(queue.claimNext()).toBeNull()
  })

  it('claimNext does not return a job whose run_at is still in the future', () => {
    const payload: JobPayload = { name: JobName.Embed, itemId: 1 }
    queue.enqueue(payload, { runAt: Date.now() + 60_000 })
    expect(queue.claimNext()).toBeNull()
  })

  it('claimNext claims the oldest due job first, regardless of insertion order', () => {
    const now = Date.now()
    const insertedSecondButDueFirst: JobPayload = { name: JobName.Embed, itemId: 1 }
    const insertedFirstButDueLater: JobPayload = { name: JobName.Embed, itemId: 2 }
    queue.enqueue(insertedFirstButDueLater, { runAt: now + 10 })
    queue.enqueue(insertedSecondButDueFirst, { runAt: now - 10 })

    const claimed = queue.claimNext(now + 100)
    expect(claimed?.payload).toEqual(insertedSecondButDueFirst)
  })

  it('claiming twice never returns the same job (single-process sanity check)', () => {
    queue.enqueue({ name: JobName.Index, itemId: 1 })
    const first = queue.claimNext()
    const second = queue.claimNext()
    expect(first).not.toBeNull()
    expect(second).toBeNull()
  })

  it('complete marks a claimed job completed', () => {
    queue.enqueue({ name: JobName.Index, itemId: 1 })
    const claimed = queue.claimNext()
    if (!claimed) throw new Error('expected a claimable job')

    const completed = queue.complete(claimed.id)
    expect(completed.state).toBe('completed')
  })

  it('fail reschedules with exponential backoff while under the max-attempts ceiling', () => {
    queue.enqueue({ name: JobName.Enrich, itemId: 1 })
    const claimed = queue.claimNext()
    if (!claimed) throw new Error('expected a claimable job')

    const before = Date.now()
    const failed = queue.fail(claimed.id, 'model timed out')
    expect(failed.state).toBe('queued')
    expect(failed.lastError).toBe('model timed out')
    expect(failed.runAt).toBeGreaterThan(before)
  })

  it('fail moves the job to failed with a human-readable last_error once attempts are exhausted', () => {
    queue.enqueue({ name: JobName.Enrich, itemId: 1 })

    let lastResult: ReturnType<JobQueue['fail']> | undefined
    for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) {
      const claimed = queue.claimNext()
      if (!claimed) throw new Error(`expected a claimable job on attempt ${i + 1}`)
      lastResult = queue.fail(claimed.id, 'model timed out', { baseDelayMs: 0, maxDelayMs: 0 })
    }

    expect(lastResult?.state).toBe('failed')
    expect(lastResult?.lastError).toBe('model timed out')
    // A failed job is terminal — never claimable again.
    expect(queue.claimNext()).toBeNull()
  })

  it('enqueue is typed against the JobPayload union — an invalid shape is a compile error, not a runtime surprise', () => {
    // @ts-expect-error — a 'resolve' job carries {url, surface}, never itemId. If this ever
    // stops erroring, the discriminated union has quietly loosened and this line should fail
    // typecheck to say so.
    const invalid: JobPayload = { name: JobName.Resolve, itemId: 1 }
    expect(invalid).toBeDefined()
  })
})

describe('computeBackoffMs', () => {
  it('doubles with each attempt', () => {
    expect(computeBackoffMs(1, { baseDelayMs: 1000 })).toBe(1000)
    expect(computeBackoffMs(2, { baseDelayMs: 1000 })).toBe(2000)
    expect(computeBackoffMs(3, { baseDelayMs: 1000 })).toBe(4000)
    expect(computeBackoffMs(4, { baseDelayMs: 1000 })).toBe(8000)
  })

  it('caps at maxDelayMs', () => {
    expect(computeBackoffMs(20, { baseDelayMs: 1000, maxDelayMs: 5000 })).toBe(5000)
  })

  it('uses the documented defaults when no options are given', () => {
    expect(computeBackoffMs(1)).toBe(DEFAULT_BASE_DELAY_MS)
    expect(computeBackoffMs(50)).toBe(DEFAULT_MAX_DELAY_MS)
  })
})

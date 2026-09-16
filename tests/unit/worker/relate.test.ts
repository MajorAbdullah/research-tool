import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/db/schema'
import { JobName } from '@/types/contracts'
import { createJobQueue, type JobQueue } from '@/lib/queue'
import { createRelateHandler } from '@/worker/jobs/relate'
import { makeTestDb, EMBEDDING_DIMS, type TestDb } from '../../helpers/db'
import { makeUser, makeItem, makeChunk } from '../../helpers/factories'

function wrap(rawDb: TestDb) {
  return drizzle(rawDb, { schema })
}

interface RelationRow {
  item_a: number
  item_b: number
  type: string
  score: number
}

describe('createRelateHandler', () => {
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

  it('writes a similar relation between two items with near-identical embeddings', async () => {
    const itemA = makeItem(rawDb, { id: 10, kind: 'github' })
    const itemB = makeItem(rawDb, { id: 20, kind: 'github' })
    makeChunk(rawDb, itemA, 'a repo about vector databases', { seed: 1 })
    makeChunk(rawDb, itemB, 'another repo about vector databases', { seed: 1 }) // same seed -> same vector

    const handler = createRelateHandler({ db, jobQueue, embeddingDimensions: EMBEDDING_DIMS })
    await handler({ name: JobName.Relate, itemId: itemA })

    const rows = db.$client.prepare('select * from relations').all() as RelationRow[]
    expect(rows).toHaveLength(1)
    expect(rows[0]?.type).toBe('similar')
    expect(rows[0]?.item_a).toBe(Math.min(itemA, itemB))
    expect(rows[0]?.item_b).toBe(Math.max(itemA, itemB))
    expect(rows[0]?.score).toBeGreaterThan(0.9) // near-identical vectors -> near-1 score

    expect(jobQueue.claimNext()?.name).toBe('index')
  })

  it('never relates across users, even when the embeddings are identical', async () => {
    const mine = makeItem(rawDb, { id: 30, userId: 1, kind: 'github' })
    const someoneElses = makeItem(rawDb, { id: 40, userId: 2, kind: 'github' })
    makeChunk(rawDb, mine, 'shared text', { seed: 5, userId: 1 })
    makeChunk(rawDb, someoneElses, 'shared text', { seed: 5, userId: 2 })

    const handler = createRelateHandler({ db, jobQueue, embeddingDimensions: EMBEDDING_DIMS })
    await handler({ name: JobName.Relate, itemId: mine })

    const rows = db.$client.prepare('select * from relations').all()
    expect(rows).toHaveLength(0)
  })

  it('an item with zero chunks skips relating entirely but still enqueues index', async () => {
    const itemId = makeItem(rawDb, { id: 50, kind: 'other' })
    const handler = createRelateHandler({ db, jobQueue, embeddingDimensions: EMBEDDING_DIMS })

    await expect(handler({ name: JobName.Relate, itemId })).resolves.toBeUndefined()

    expect(db.$client.prepare('select count(*) c from relations').get()).toEqual({ c: 0 })
    expect(jobQueue.claimNext()?.name).toBe('index')
  })

  it('is idempotently re-runnable: relating the same pair twice does not throw or duplicate', async () => {
    const itemA = makeItem(rawDb, { id: 60, kind: 'github' })
    const itemB = makeItem(rawDb, { id: 70, kind: 'github' })
    makeChunk(rawDb, itemA, 'x', { seed: 2 })
    makeChunk(rawDb, itemB, 'x', { seed: 2 })

    const handler = createRelateHandler({ db, jobQueue, embeddingDimensions: EMBEDDING_DIMS })
    await handler({ name: JobName.Relate, itemId: itemA })
    await expect(handler({ name: JobName.Relate, itemId: itemA })).resolves.toBeUndefined()

    const rows = db.$client.prepare('select * from relations').all()
    expect(rows).toHaveLength(1)
  })

  it('does not relate an item to itself', async () => {
    const itemId = makeItem(rawDb, { id: 80, kind: 'github' })
    makeChunk(rawDb, itemId, 'solo chunk one', { seed: 3, ord: 0 })
    makeChunk(rawDb, itemId, 'solo chunk two', { seed: 3, ord: 1 })

    const handler = createRelateHandler({ db, jobQueue, embeddingDimensions: EMBEDDING_DIMS })
    await handler({ name: JobName.Relate, itemId })

    expect(db.$client.prepare('select count(*) c from relations').get()).toEqual({ c: 0 })
  })

  it('does not relate items whose distance is beyond the threshold', async () => {
    const itemA = makeItem(rawDb, { id: 90, kind: 'github' })
    const itemB = makeItem(rawDb, { id: 91, kind: 'github' })
    makeChunk(rawDb, itemA, 'x', { seed: 1 })
    makeChunk(rawDb, itemB, 'y', { seed: 9 }) // very different seed -> far apart

    const handler = createRelateHandler({ db, jobQueue, embeddingDimensions: EMBEDDING_DIMS })
    await handler({ name: JobName.Relate, itemId: itemA })

    expect(db.$client.prepare('select count(*) c from relations').get()).toEqual({ c: 0 })
  })
})

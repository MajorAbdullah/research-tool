import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/db/schema'
import { JobName } from '@/types/contracts'
import { createJobQueue, type JobQueue } from '@/lib/queue'
import { createEmbedHandler } from '@/worker/jobs/embed'
import { makeTestDb, type TestDb } from '../../helpers/db'
import { makeUser, makeItem } from '../../helpers/factories'
import { createFakeEmbeddingProvider, FAKE_EMBEDDING_MODEL } from '../../helpers/fakes'

function wrap(rawDb: TestDb) {
  return drizzle(rawDb, { schema })
}

// Long enough (well over chunker.ts's SHORT_ITEM_TOKEN_THRESHOLD of 200 tokens) to be split into
// more than one chunk instead of the short-item single-chunk path.
const LONG_CONTENT = Array.from(
  { length: 40 },
  (_, i) => `This is sentence number ${i} about the fascinating topic of distributed systems.`,
).join(' ')

describe('createEmbedHandler', () => {
  let rawDb: TestDb
  let db: ReturnType<typeof wrap>
  let jobQueue: JobQueue
  const embeddingProvider = createFakeEmbeddingProvider()

  beforeEach(() => {
    rawDb = makeTestDb()
    makeUser(rawDb, 1)
    db = wrap(rawDb)
    jobQueue = createJobQueue(rawDb)
  })

  it('chunks, embeds, and inserts chunks + chunk_vec rows (BigInt rowid), then enqueues relate', async () => {
    const itemId = makeItem(rawDb, { kind: 'article', content: LONG_CONTENT })
    const handler = createEmbedHandler({ db, jobQueue, embeddingProvider })

    await handler({ name: JobName.Embed, itemId })

    const chunkRows = db.$client
      .prepare('select * from chunks where item_id = ? order by ord')
      .all(itemId) as Array<{ embedding_model: string; ord: number }>
    expect(chunkRows.length).toBeGreaterThan(1)
    expect(chunkRows.every((c) => c.embedding_model === FAKE_EMBEDDING_MODEL)).toBe(true)
    expect(chunkRows.map((c) => c.ord)).toEqual(chunkRows.map((_, i) => i))

    const vecCount = db.$client
      .prepare('select count(*) c from chunk_vec')
      .get() as { c: number }
    expect(vecCount.c).toBe(chunkRows.length)

    expect(jobQueue.claimNext()?.name).toBe('relate')
  })

  it('is idempotently re-runnable: a second run replaces rather than duplicates chunks', async () => {
    const itemId = makeItem(rawDb, { kind: 'article', content: LONG_CONTENT })
    const handler = createEmbedHandler({ db, jobQueue, embeddingProvider })

    await handler({ name: JobName.Embed, itemId })
    const firstCount = (
      db.$client.prepare('select count(*) c from chunks where item_id = ?').get(itemId) as {
        c: number
      }
    ).c

    await handler({ name: JobName.Embed, itemId })
    const secondCount = (
      db.$client.prepare('select count(*) c from chunks where item_id = ?').get(itemId) as {
        c: number
      }
    ).c

    expect(secondCount).toBe(firstCount)
    const vecCount = (db.$client.prepare('select count(*) c from chunk_vec').get() as { c: number }).c
    expect(vecCount).toBe(secondCount) // no orphaned vectors left over from the first run either
  })

  it('an item with empty content produces zero chunks but still enqueues relate', async () => {
    const itemId = makeItem(rawDb, { kind: 'other', content: '' })
    const handler = createEmbedHandler({ db, jobQueue, embeddingProvider })

    await expect(handler({ name: JobName.Embed, itemId })).resolves.toBeUndefined()

    const chunkCount = (
      db.$client.prepare('select count(*) c from chunks where item_id = ?').get(itemId) as {
        c: number
      }
    ).c
    expect(chunkCount).toBe(0)
    expect(jobQueue.claimNext()?.name).toBe('relate')
  })

  it('short, self-contained content becomes exactly one contextualized chunk', async () => {
    const itemId = makeItem(rawDb, { kind: 'social', title: 'a tweet', content: 'short post text' })
    const handler = createEmbedHandler({ db, jobQueue, embeddingProvider })

    await handler({ name: JobName.Embed, itemId })

    const rows = db.$client.prepare('select text from chunks where item_id = ?').all(itemId) as Array<{
      text: string
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0]?.text).toContain('short post text')
    expect(rows[0]?.text).toContain('a tweet')
  })
})

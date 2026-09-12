import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/db/schema'
import { JobName } from '@/types/contracts'
import { BudgetExhaustedError, ChainExhaustedError } from '@/lib/ai'
import { createJobQueue, type JobQueue } from '@/lib/queue'
import { createEnrichHandler } from '@/worker/jobs/enrich'
import { getItemById } from '@/repositories/items'
import { listTopicsForUser } from '@/repositories/topics'
import { makeTestDb, type TestDb } from '../../helpers/db'
import { makeUser, makeItem } from '../../helpers/factories'
import { createFakeEmbeddingProvider, createFakeLlmProvider } from '../../helpers/fakes'

function wrap(rawDb: TestDb) {
  return drizzle(rawDb, { schema })
}

const VALID_RESULT = {
  tldr: 'A concise summary of the repo.',
  bullets: ['does thing one', 'does thing two', 'does thing three'],
  tags: ['typescript', 'cli', 'testing'],
  topic: 'Dev Tooling',
  confidence: 0.9,
  kindFields: { what_it_does: 'x', primary_use_case: 'y' },
}

describe('createEnrichHandler', () => {
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

  it('persists tldr/bullets/tags/topic/kindFields and enqueues embed on success', async () => {
    const itemId = makeItem(rawDb, { kind: 'github', title: 'owner/repo' })
    const provider = createFakeLlmProvider({ structured: () => VALID_RESULT })
    const handler = createEnrichHandler({ db, jobQueue, provider, embeddingProvider })

    await handler({ name: JobName.Enrich, itemId })

    const item = getItemById(db, itemId)
    expect(item?.summaryTldr).toBe(VALID_RESULT.tldr)
    expect(item?.summaryBullets).toEqual(VALID_RESULT.bullets)
    expect(item?.kindFields).toEqual(VALID_RESULT.kindFields)
    expect(item?.status).toBe('processing')

    const tagRows = db.$client
      .prepare(
        `select t.label from tags t join item_tags it on it.tag_id = t.id where it.item_id = ?`,
      )
      .all(itemId) as Array<{ label: string }>
    expect(tagRows.map((r) => r.label).sort()).toEqual([...VALID_RESULT.tags].sort())

    const topics = listTopicsForUser(db, 1)
    expect(topics.map((t) => t.label)).toEqual(['Dev Tooling'])

    expect(jobQueue.claimNext()?.name).toBe('embed')
  })

  it('reuses an existing topic instead of creating a near-duplicate', async () => {
    const itemId = makeItem(rawDb, { kind: 'github' })
    db.$client
      .prepare('insert into topics (user_id, slug, label) values (1, ?, ?)')
      .run('dev-tooling', 'Dev Tooling')

    const provider = createFakeLlmProvider({ structured: () => VALID_RESULT })
    const handler = createEnrichHandler({ db, jobQueue, provider, embeddingProvider })
    await handler({ name: JobName.Enrich, itemId })

    const topics = listTopicsForUser(db, 1)
    expect(topics).toHaveLength(1) // no second, near-duplicate topic created

    const itemTopicRows = db.$client
      .prepare('select topic_id from item_topics where item_id = ?')
      .all(itemId) as Array<{ topic_id: number }>
    expect(itemTopicRows[0]?.topic_id).toBe(topics[0]?.id)
  })

  it('on BudgetExhaustedError, re-queues enrich at resetAt instead of failing', async () => {
    const itemId = makeItem(rawDb, { kind: 'github' })
    const resetAt = Date.now() + 6 * 60 * 60 * 1000
    const provider = createFakeLlmProvider({
      structured: () => {
        throw new BudgetExhaustedError(resetAt, 'background')
      },
    })
    const handler = createEnrichHandler({ db, jobQueue, provider, embeddingProvider })

    await expect(handler({ name: JobName.Enrich, itemId })).resolves.toBeUndefined()

    const item = getItemById(db, itemId)
    expect(item?.status).not.toBe('failed')
    expect(item?.failureReason).toBeNull()

    const requeued = db.$client
      .prepare(`select * from jobs where name = 'enrich'`)
      .all() as Array<{ state: string; run_at: number }>
    expect(requeued).toHaveLength(1)
    expect(requeued[0]?.state).toBe('queued')
    expect(requeued[0]?.run_at).toBe(resetAt)

    // never an `embed` job — enrichment did not actually complete
    expect(db.$client.prepare(`select count(*) c from jobs where name = 'embed'`).get()).toEqual({
      c: 0,
    })
  })

  it('on a chain-exhausted (model_unavailable) outcome, throws so queue.ts retries', async () => {
    const itemId = makeItem(rawDb, { kind: 'github' })
    const provider = createFakeLlmProvider({
      structured: () => {
        throw new ChainExhaustedError('enrich', [{ model: 'm1', status: 503, message: 'down' }])
      },
    })
    const handler = createEnrichHandler({ db, jobQueue, provider, embeddingProvider })

    await expect(handler({ name: JobName.Enrich, itemId })).rejects.toThrow(/enrich:/)

    const item = getItemById(db, itemId)
    expect(item?.status).toBe('processing')
    expect(item?.failureReason).toBeNull()
  })

  it('passes the item content and existing topics into the prompt input', async () => {
    const itemId = makeItem(rawDb, {
      kind: 'article',
      title: 'A Great Post',
      content: 'the body of the post',
    })
    db.$client
      .prepare('insert into topics (user_id, slug, label) values (1, ?, ?)')
      .run('existing', 'Existing Topic')

    let seenMessages: unknown
    const provider = createFakeLlmProvider({
      structured: (messages) => {
        seenMessages = messages
        return VALID_RESULT
      },
    })
    const handler = createEnrichHandler({ db, jobQueue, provider, embeddingProvider })
    await handler({ name: JobName.Enrich, itemId })

    const userMessage = (seenMessages as Array<{ role: string; content: string }>).find(
      (m) => m.role === 'user',
    )
    expect(userMessage?.content).toContain('A Great Post')
    expect(userMessage?.content).toContain('the body of the post')
    expect(userMessage?.content).toContain('Existing Topic')
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/db/schema'
import { JobName } from '@/types/contracts'
import { createJobQueue, type JobQueue } from '@/lib/queue'
import { createResolveHandler } from '@/worker/jobs/resolve'
import { makeTestDb, type TestDb } from '../../helpers/db'
import { makeUser } from '../../helpers/factories'

function wrap(rawDb: TestDb) {
  return drizzle(rawDb, { schema })
}

describe('createResolveHandler', () => {
  let rawDb: TestDb
  let db: ReturnType<typeof wrap>
  let jobQueue: JobQueue
  let handler: ReturnType<typeof createResolveHandler>

  beforeEach(() => {
    rawDb = makeTestDb()
    makeUser(rawDb, 1)
    db = wrap(rawDb)
    jobQueue = createJobQueue(rawDb)
    handler = createResolveHandler({ db, jobQueue })
  })

  it('creates a new item, canonicalizes the URL, classifies the kind, and enqueues extract', async () => {
    await handler({
      name: JobName.Resolve,
      url: 'https://github.com/torvalds/linux',
      surface: 'web',
    })

    const rows = db.$client.prepare('select * from items').all() as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]?.canonical_url).toBe('https://github.com/torvalds/linux')
    expect(rows[0]?.kind).toBe('github')
    expect(rows[0]?.status).toBe('queued')

    const job = jobQueue.claimNext()
    expect(job?.name).toBe('extract')
    expect(job?.payload).toEqual({
      name: 'extract',
      itemId: rows[0]?.id,
    })
  })

  it('canonicalizes before hashing, so a www./trailing-slash variant dedupes with the bare URL', async () => {
    await handler({ name: JobName.Resolve, url: 'https://example.com/post/', surface: 'web' })
    await handler({ name: JobName.Resolve, url: 'https://www.example.com/post', surface: 'pwa' })

    const rows = db.$client.prepare('select * from items').all()
    expect(rows).toHaveLength(1)
  })

  it('a bare duplicate touches updated_at, creates no new row, and does not re-enqueue extract', async () => {
    // Seed through the handler itself so url_hash is the real sha256 of the canonical URL, not
    // the synthetic `hash-<id>` tests/helpers/factories.ts's makeItem() uses for unrelated tests.
    await handler({ name: JobName.Resolve, url: 'https://example.com/post', surface: 'web' })
    const itemId = (jobQueue.claimNext()?.payload as { itemId: number }).itemId
    db.$client.prepare("update items set extraction_tier = 'full' where id = ?").run(itemId)
    const before = (
      db.$client.prepare('select updated_at as u from items where id = ?').get(itemId) as {
        u: number
      }
    ).u

    await new Promise((r) => setTimeout(r, 5))
    await handler({ name: JobName.Resolve, url: 'https://example.com/post', surface: 'web' })

    const rows = db.$client.prepare('select * from items').all()
    expect(rows).toHaveLength(1)
    const after = (
      db.$client.prepare('select updated_at as u from items where id = ?').get(itemId) as {
        u: number
      }
    ).u
    expect(after).toBeGreaterThan(before)
    expect(jobQueue.claimNext()).toBeNull()
  })

  it('a duplicate arriving with a fresh hint re-enqueues extract when not already full tier', async () => {
    await handler({ name: JobName.Resolve, url: 'https://example.com/video', surface: 'web' })
    const itemId = (jobQueue.claimNext()?.payload as { itemId: number }).itemId
    db.$client.prepare("update items set extraction_tier = 'partial' where id = ?").run(itemId)

    await handler({
      name: JobName.Resolve,
      url: 'https://example.com/video',
      surface: 'extension',
      hint: { transcript: 'fresh transcript text' },
    })

    const job = jobQueue.claimNext()
    expect(job?.name).toBe('extract')
    expect(job?.payload).toEqual({
      name: 'extract',
      itemId,
      hint: { transcript: 'fresh transcript text' },
    })
  })

  it('a duplicate arriving with a fresh hint does NOT re-enqueue extract once already full tier', async () => {
    await handler({ name: JobName.Resolve, url: 'https://example.com/video2', surface: 'web' })
    const itemId = (jobQueue.claimNext()?.payload as { itemId: number }).itemId
    db.$client.prepare("update items set extraction_tier = 'full' where id = ?").run(itemId)

    await handler({
      name: JobName.Resolve,
      url: 'https://example.com/video2',
      surface: 'extension',
      hint: { transcript: 'fresh transcript text' },
    })

    expect(jobQueue.claimNext()).toBeNull()
  })

  it('stores the optional note on a new item', async () => {
    await handler({
      name: JobName.Resolve,
      url: 'https://example.com/noted',
      surface: 'web',
      note: 'read this later',
    })
    const row = db.$client.prepare('select note from items').get() as { note: string }
    expect(row.note).toBe('read this later')
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/db/schema'
import { ExtractionTier, ItemKind, JobName } from '@/types/contracts'
import type { ClientCapture, ExtractedContent, Extractor } from '@/types/contracts'
import { ExtractionError } from '@/lib/extractors'
import { createJobQueue, type JobQueue } from '@/lib/queue'
import { createExtractHandler } from '@/worker/jobs/extract'
import { getItemById } from '@/repositories/items'
import { makeTestDb, type TestDb } from '../../helpers/db'
import { makeUser, makeItem } from '../../helpers/factories'

function wrap(rawDb: TestDb) {
  return drizzle(rawDb, { schema })
}

/** A minimal fake `Extractor` — resolves to `result` or rejects with `error`, whichever is set. */
function fakeExtractor(
  kind: ItemKind,
  behavior: { result?: ExtractedContent; error?: Error; matches?: boolean } = {},
): Extractor {
  return {
    kind,
    matches: () => behavior.matches ?? true,
    async extract(_url: string, _hint?: ClientCapture): Promise<ExtractedContent> {
      if (behavior.error) throw behavior.error
      return behavior.result ?? { contentText: 'default', extractionTier: ExtractionTier.Full }
    },
  }
}

describe('createExtractHandler', () => {
  let rawDb: TestDb
  let db: ReturnType<typeof wrap>
  let jobQueue: JobQueue

  beforeEach(() => {
    rawDb = makeTestDb()
    makeUser(rawDb, 1)
    db = wrap(rawDb)
    jobQueue = createJobQueue(rawDb)
  })

  it('persists a full extraction result and enqueues enrich', async () => {
    const itemId = makeItem(rawDb, { kind: 'github', content: null })
    const extractor = fakeExtractor(ItemKind.Github, {
      result: {
        contentText: 'a full readme',
        extractionTier: ExtractionTier.Full,
        title: 'owner/repo',
        author: 'owner',
        thumbnailUrl: 'https://example.com/thumb.png',
        kindFields: { language: 'TypeScript', stars: 42 },
        rawPayload: { raw: true },
      },
    })
    const handler = createExtractHandler({ db, jobQueue, extractors: [extractor] })

    await handler({ name: JobName.Extract, itemId })

    const item = getItemById(db, itemId)
    expect(item?.contentText).toBe('a full readme')
    expect(item?.extractionTier).toBe('full')
    expect(item?.title).toBe('owner/repo')
    expect(item?.kindFields).toEqual({ language: 'TypeScript', stars: 42 })
    expect(item?.status).toBe('processing')

    const job = jobQueue.claimNext()
    expect(job?.name).toBe('enrich')
    expect(job?.payload).toEqual({ name: 'enrich', itemId })
  })

  it('a YouTube 429 (partial tier) is success, not failure — the pipeline still continues', async () => {
    const itemId = makeItem(rawDb, { kind: 'video' })
    const extractor = fakeExtractor(ItemKind.Video, {
      result: {
        contentText: 'title/author only, no transcript — timedtext returned 429',
        extractionTier: ExtractionTier.Partial,
        title: 'a cool video',
      },
    })
    const handler = createExtractHandler({ db, jobQueue, extractors: [extractor] })

    await expect(handler({ name: JobName.Extract, itemId })).resolves.toBeUndefined()

    const item = getItemById(db, itemId)
    expect(item?.extractionTier).toBe('partial')
    expect(item?.status).not.toBe('failed')
    expect(jobQueue.claimNext()?.name).toBe('enrich')
  })

  it('falls back to a local metadata_only result when no extractor matches the URL', async () => {
    const itemId = makeItem(rawDb, {
      kind: 'other',
      url: 'https://example.com/some/page-title',
    })
    // makeItem()'s own `title` fallback (`?? 'Item <id>'`) triggers even on an explicit `null`
    // override (nullish coalescing treats both the same) — force it null directly to reproduce
    // a genuinely fresh, not-yet-extracted item (title is only ever set by extract itself).
    db.$client.prepare('update items set title = null where id = ?').run(itemId)
    const extractor = fakeExtractor(ItemKind.Github, { matches: false })
    const handler = createExtractHandler({ db, jobQueue, extractors: [extractor] })

    await handler({ name: JobName.Extract, itemId })

    const item = getItemById(db, itemId)
    expect(item?.extractionTier).toBe('metadata_only')
    expect(item?.contentText).toBe('page-title')
    expect(jobQueue.claimNext()?.name).toBe('enrich')
  })

  it('a structurally permanent ExtractionError marks the item failed and does not enqueue enrich', async () => {
    const itemId = makeItem(rawDb, { kind: 'github' })
    const extractor = fakeExtractor(ItemKind.Github, {
      error: new ExtractionError('not_found', 'repository not found or renamed'),
    })
    const handler = createExtractHandler({ db, jobQueue, extractors: [extractor] })

    await expect(handler({ name: JobName.Extract, itemId })).resolves.toBeUndefined()

    const item = getItemById(db, itemId)
    expect(item?.status).toBe('failed')
    expect(item?.failureReason).toBe('repository not found or renamed')
    expect(jobQueue.claimNext()).toBeNull()
  })

  it('a retryable ExtractionError rethrows without marking the item failed (retries remain)', async () => {
    const itemId = makeItem(rawDb, { kind: 'github' })
    const extractor = fakeExtractor(ItemKind.Github, {
      error: new ExtractionError('rate_limited', 'GitHub API rate limit exceeded'),
    })
    const handler = createExtractHandler({ db, jobQueue, extractors: [extractor] })

    await expect(handler({ name: JobName.Extract, itemId })).rejects.toThrow(
      'GitHub API rate limit exceeded',
    )

    const item = getItemById(db, itemId)
    expect(item?.status).toBe('processing')
    expect(item?.failureReason).toBeNull()
  })

  it('throws (never silently no-ops) when the item row does not exist', async () => {
    const handler = createExtractHandler({ db, jobQueue, extractors: [] })
    await expect(
      handler({ name: JobName.Extract, itemId: 999_999 }),
    ).rejects.toThrow(/no item with id/)
  })
})

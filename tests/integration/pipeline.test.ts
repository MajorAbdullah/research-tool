/**
 * Drives the full ingest pipeline (P7) end to end against a real in-memory SQLite
 * (tests/helpers/db.ts's makeTestDb(), the actual drizzle/0000_init.sql migration — FTS5
 * triggers and the vec0 table included), the real job queue (src/lib/queue.ts), and the real six
 * stage handlers, with only the network-touching pieces replaced: a fake `Extractor` per test
 * (never P2's real HTTP-calling extractors) and a fake `LLMProvider`/`EmbeddingProvider`
 * (tests/helpers/fakes.ts). No test in this file makes a network call.
 *
 * There is no real worker loop running here — `drainQueue` below is a tiny stand-in for
 * `src/worker/loop.ts`'s claim -> dispatch -> complete/fail cycle, dispatching by `job.name` to
 * the handler map built once per test in `buildPipeline()`.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/db/schema'
import { ExtractionTier, ItemKind, JobName } from '@/types/contracts'
import type {
  ClientCapture,
  ExtractedContent,
  Extractor,
  JobPayload,
  ResolveJobPayload,
} from '@/types/contracts'
import { ExtractionError } from '@/lib/extractors'
import { BudgetExhaustedError } from '@/lib/ai'
import { createJobQueue, type JobQueue } from '@/lib/queue'
import { createResolveHandler } from '@/worker/jobs/resolve'
import { createExtractHandler } from '@/worker/jobs/extract'
import { createEnrichHandler } from '@/worker/jobs/enrich'
import { createEmbedHandler } from '@/worker/jobs/embed'
import { createRelateHandler } from '@/worker/jobs/relate'
import { createIndexHandler } from '@/worker/jobs/index-stage'
import { retryItemFromStage } from '@/worker/retry'
import { getItemById } from '@/repositories/items'
import { makeTestDb, type TestDb } from '../helpers/db'
import { makeUser } from '../helpers/factories'
import {
  createFakeEmbeddingProvider,
  createFakeLlmProvider,
  type FakeLlmProviderOptions,
} from '../helpers/fakes'

function wrap(rawDb: TestDb) {
  return drizzle(rawDb, { schema })
}

/** Resolves to `result` (or rejects with `error`) for every call — a simple stand-in for one of
 *  P2's real extractors, matching only the given `kind`. */
function fakeExtractor(
  kind: ItemKind,
  behavior: { result?: ExtractedContent; error?: Error } = {},
): Extractor & { calls: number } {
  const self = {
    kind,
    calls: 0,
    matches: () => true,
    async extract(_url: string, _hint?: ClientCapture): Promise<ExtractedContent> {
      self.calls += 1
      if (behavior.error) throw behavior.error
      return behavior.result ?? { contentText: 'default', extractionTier: ExtractionTier.Full }
    },
  }
  return self
}

const VALID_ENRICHMENT = {
  tldr: 'A concise summary.',
  bullets: ['point one', 'point two', 'point three'],
  tags: ['typescript', 'testing', 'cli'],
  topic: 'Dev Tooling',
  confidence: 0.85,
  kindFields: { what_it_does: 'does the thing', primary_use_case: 'CI pipelines' },
}

interface BuildPipelineOptions {
  extractor: Extractor
  llm?: FakeLlmProviderOptions
}

function buildPipeline(rawDb: TestDb, options: BuildPipelineOptions) {
  const db = wrap(rawDb)
  const jobQueue = createJobQueue(rawDb)
  const embeddingProvider = createFakeEmbeddingProvider()
  const provider = createFakeLlmProvider(options.llm ?? { structured: () => VALID_ENRICHMENT })

  const handlers: Record<string, (payload: JobPayload) => Promise<void>> = {
    [JobName.Resolve]: createResolveHandler({ db, jobQueue }) as (p: JobPayload) => Promise<void>,
    [JobName.Extract]: createExtractHandler({ db, jobQueue, extractors: [options.extractor] }) as (
      p: JobPayload,
    ) => Promise<void>,
    [JobName.Enrich]: createEnrichHandler({ db, jobQueue, provider, embeddingProvider }) as (
      p: JobPayload,
    ) => Promise<void>,
    [JobName.Embed]: createEmbedHandler({ db, jobQueue, embeddingProvider }) as (
      p: JobPayload,
    ) => Promise<void>,
    [JobName.Relate]: createRelateHandler({ db, jobQueue }) as (p: JobPayload) => Promise<void>,
    [JobName.Index]: createIndexHandler({ db }) as (p: JobPayload) => Promise<void>,
  }

  return { db, jobQueue, handlers }
}

const MAX_DRAIN_ITERATIONS = 100

/** Stands in for src/worker/loop.ts: claims the next due job, dispatches it by name, and
 *  completes/fails it exactly as the real loop would — until the queue has nothing left to claim
 *  right now (a job scheduled in the future, e.g. enrich's budget-exhausted re-queue, correctly
 *  ends the drain rather than being claimed early). */
async function drainQueue(
  jobQueue: JobQueue,
  handlers: Record<string, (payload: JobPayload) => Promise<void>>,
): Promise<void> {
  for (let i = 0; i < MAX_DRAIN_ITERATIONS; i++) {
    const job = jobQueue.claimNext()
    if (!job) return
    try {
      await handlers[job.name]?.(job.payload)
      jobQueue.complete(job.id)
    } catch (err) {
      jobQueue.fail(job.id, err instanceof Error ? err.message : String(err))
    }
  }
  throw new Error('drainQueue: exceeded MAX_DRAIN_ITERATIONS — likely an infinite requeue loop')
}

function resolvePayload(url: string, extra: Partial<ResolveJobPayload> = {}): ResolveJobPayload {
  return { name: JobName.Resolve, url, surface: 'web', ...extra }
}

describe('ingest pipeline (P7) — resolve -> extract -> enrich -> embed -> relate -> index', () => {
  let rawDb: TestDb

  beforeEach(() => {
    rawDb = makeTestDb()
    makeUser(rawDb, 1)
  })

  it('a GitHub URL ends at inbox with tldr, tags, topic, kind_fields, and chunks present', async () => {
    const extractor = fakeExtractor(ItemKind.Github, {
      result: {
        contentText:
          'vllm-project/vllm is a high-throughput inference engine for large language models. ' +
          'It supports continuous batching and PagedAttention for efficient memory use.',
        extractionTier: ExtractionTier.Full,
        title: 'vllm-project/vllm',
        author: 'vllm-project',
        kindFields: { language: 'Python', stars: 30000, license: 'Apache-2.0' },
      },
    })
    const { db, jobQueue, handlers } = buildPipeline(rawDb, { extractor })

    jobQueue.enqueue(resolvePayload('https://github.com/vllm-project/vllm'))
    await drainQueue(jobQueue, handlers)

    const row = db.$client.prepare('select * from items').get() as Record<string, unknown>
    expect(row.status).toBe('inbox')
    expect(row.kind).toBe('github')
    expect(row.extraction_tier).toBe('full')
    expect(row.summary_tldr).toBe(VALID_ENRICHMENT.tldr)
    expect(JSON.parse(row.summary_bullets as string)).toEqual(VALID_ENRICHMENT.bullets)
    expect(JSON.parse(row.kind_fields as string)).toEqual({
      language: 'Python',
      stars: 30000,
      license: 'Apache-2.0',
      what_it_does: 'does the thing',
      primary_use_case: 'CI pipelines',
    })

    const tagLabels = db.$client
      .prepare(
        'select t.label from tags t join item_tags it on it.tag_id = t.id where it.item_id = ?',
      )
      .all(row.id) as Array<{ label: string }>
    expect(tagLabels.map((t) => t.label).sort()).toEqual([...VALID_ENRICHMENT.tags].sort())

    const topicLabels = db.$client
      .prepare(
        'select tp.label from topics tp join item_topics it on it.topic_id = tp.id where it.item_id = ?',
      )
      .all(row.id) as Array<{ label: string }>
    expect(topicLabels).toEqual([{ label: 'Dev Tooling' }])

    const chunkCount = (
      db.$client.prepare('select count(*) c from chunks where item_id = ?').get(row.id) as {
        c: number
      }
    ).c
    expect(chunkCount).toBeGreaterThan(0)
    const vecCount = (db.$client.prepare('select count(*) c from chunk_vec').get() as { c: number })
      .c
    expect(vecCount).toBe(chunkCount)
  })

  it('a duplicate URL does not create a second row', async () => {
    const extractor = fakeExtractor(ItemKind.Github)
    const { db, jobQueue, handlers } = buildPipeline(rawDb, { extractor })

    jobQueue.enqueue(resolvePayload('https://github.com/foo/bar'))
    await drainQueue(jobQueue, handlers)

    jobQueue.enqueue(resolvePayload('https://github.com/foo/bar'))
    await drainQueue(jobQueue, handlers)

    const rows = db.$client.prepare('select * from items').all()
    expect(rows).toHaveLength(1)
  })

  it('a YouTube 429 during extract yields extraction_tier=partial and the item still reaches inbox', async () => {
    // Mirrors what P2's real ladder does on a 429 from the timedtext endpoint: it's swallowed
    // internally and degrades to a partial-tier result — it never throws out to the caller (see
    // ladder.ts / ADR 0006). The fake extractor below reproduces that resolved-not-rejected shape
    // directly, rather than re-testing P2's own ladder logic (out of this phase's scope).
    const extractor = fakeExtractor(ItemKind.Video, {
      result: {
        contentText: 'title and author only — the transcript endpoint returned 429',
        extractionTier: ExtractionTier.Partial,
        title: 'a great talk',
      },
    })
    const { db, jobQueue, handlers } = buildPipeline(rawDb, { extractor })

    jobQueue.enqueue(resolvePayload('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
    await drainQueue(jobQueue, handlers)

    const row = db.$client.prepare('select * from items').get() as Record<string, unknown>
    expect(row.extraction_tier).toBe('partial')
    expect(row.status).toBe('inbox')
  })

  it('BudgetExhausted in enrich leaves the job queued (not failed) and the item stays keyword-searchable', async () => {
    const extractor = fakeExtractor(ItemKind.Github, {
      result: {
        contentText: 'a distinctive phrase: zephyrsaurus',
        extractionTier: ExtractionTier.Full,
        title: 'Zephyrsaurus Repo',
      },
    })
    const resetAt = Date.now() + 6 * 60 * 60 * 1000
    const { db, jobQueue, handlers } = buildPipeline(rawDb, {
      extractor,
      llm: {
        structured: () => {
          throw new BudgetExhaustedError(resetAt, 'background')
        },
      },
    })

    jobQueue.enqueue(resolvePayload('https://github.com/z/zephyrsaurus'))
    await drainQueue(jobQueue, handlers)

    const row = db.$client.prepare('select * from items').get() as Record<string, unknown>
    expect(row.status).not.toBe('failed')
    expect(row.status).not.toBe('inbox') // never reached embed/relate/index

    // jobs.rows accumulate across state transitions (a completed job's row is never deleted) —
    // what matters here is what's still PENDING, not the full lifetime row count.
    const pendingJobs = db.$client
      .prepare(`select * from jobs where state in ('queued', 'active')`)
      .all() as Array<{ name: string; state: string; run_at: number }>
    expect(pendingJobs).toHaveLength(1)
    expect(pendingJobs[0]).toMatchObject({ name: 'enrich', state: 'queued', run_at: resetAt })

    // Extraction already synced items_fts (title + content_text) before enrich ever ran — the
    // item is findable by keyword even though its AI summary hasn't landed yet.
    const { c } = db.$client
      .prepare("select count(*) c from items_fts where items_fts match 'zephyrsaurus'")
      .get() as { c: number }
    expect(c).toBe(1)
  })

  it('a permanent extract failure sets status=failed with a reason, never stuck in processing', async () => {
    const extractor = fakeExtractor(ItemKind.Github, {
      error: new ExtractionError('not_found', 'repository renamed or deleted'),
    })
    const { db, jobQueue, handlers } = buildPipeline(rawDb, { extractor })

    jobQueue.enqueue(resolvePayload('https://github.com/ghost/repo'))
    await drainQueue(jobQueue, handlers)

    const row = db.$client.prepare('select * from items').get() as Record<string, unknown>
    expect(row.status).toBe('failed')
    expect(row.status).not.toBe('processing')
    expect(row.failure_reason).toBe('repository renamed or deleted')

    // the pipeline never continued past the failed stage — nothing left pending
    expect(
      db.$client.prepare(`select count(*) c from jobs where state in ('queued', 'active')`).get(),
    ).toEqual({ c: 0 })
  })

  it('retry-from-stage re-runs only the requested stage (and its normal downstream cascade)', async () => {
    const extractor = fakeExtractor(ItemKind.Github, {
      result: {
        contentText: 'original content about rust async runtimes',
        extractionTier: ExtractionTier.Full,
        title: 'tokio-rs/tokio',
      },
    })
    const { db, jobQueue, handlers } = buildPipeline(rawDb, { extractor })

    jobQueue.enqueue(resolvePayload('https://github.com/tokio-rs/tokio'))
    await drainQueue(jobQueue, handlers)

    const itemId = (db.$client.prepare('select id from items').get() as { id: number }).id
    expect(extractor.calls).toBe(1)
    expect(getItemById(db, itemId)?.status).toBe('inbox')

    const outcome = retryItemFromStage(db, jobQueue, {
      userId: 1,
      itemId,
      stage: JobName.Enrich,
    })
    expect(outcome.ok).toBe(true)
    await drainQueue(jobQueue, handlers)

    // extract did NOT run again — only enrich (and its normal downstream cascade) did.
    expect(extractor.calls).toBe(1)
    expect(getItemById(db, itemId)?.status).toBe('inbox')
    // the original content survived untouched (retrying enrich never re-extracts).
    expect(getItemById(db, itemId)?.contentText).toBe('original content about rust async runtimes')
  })
})

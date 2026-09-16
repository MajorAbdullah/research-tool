/**
 * Boot-time wiring for the ingest pipeline (P7): constructs every shared AI/embedding dependency
 * EXACTLY ONCE (mirrors scripts/smoke-ai.ts, P3's own worked example of assembling this stack),
 * then installs the six real stage handlers into `registry` (src/worker/registry.ts) — replacing
 * P1's no-op placeholders. Called from `instrumentation.ts`, once, before `startWorkerLoop()`.
 *
 * Why "exactly once" matters for each piece:
 * - `CapabilityProbe`: one HTTP call to OpenRouter's model catalog. Every job handler needs the
 *   SAME resolved schema-strategy-per-model; probing per job would waste the very request budget
 *   this whole system exists to conserve (CLAUDE.md's Free-Tier Budget).
 * - `BudgetManager` / `TokenBucket`: the daily cap and the ~18/min pacer are both process-wide,
 *   shared-counter state (ADR 0004) — two independent instances would each think they had the
 *   full budget to themselves.
 * - The local embedding provider: ~350 MB resident once loaded (CLAUDE.md). It's already a
 *   `globalThis`-guarded singleton inside the local provider itself, so calling it
 *   twice here would still only load the model once — but `enrich` (topic-assignment similarity)
 *   and `embed` need to end up sharing that exact instance rather than each reaching for their
 *   own reference independently, which is what constructing it once, here, and threading it
 *   through both handlers' deps guarantees.
 */
import { getDb } from '@/db/client'
import type { DbClient } from '@/db/client'
import { getConfig } from '@/lib/config'
import { getJobQueue } from '@/lib/queue'
import { logger } from '@/lib/logger'
import {
  createCapabilityProbe,
  BudgetManager,
  TokenBucket,
  createSqliteSettingsPort,
  createSqliteLlmCallLog,
  createEnrichmentProvider,
  RATE_LIMIT_PER_MINUTE,
} from '@/lib/ai'
import { createEmbeddingProviderFromConfig, assertEmbeddingModelMatches } from '@/lib/embeddings'
import {
  GithubExtractor,
  YoutubeExtractor,
  ArticleExtractor,
  InstagramExtractor,
  XThreadsExtractor,
  PdfExtractor,
} from '@/lib/extractors'
import type { Extractor, EmbeddingProvider, LLMProvider } from '@/types/contracts'
import { registerJobHandlers } from './registry'
import {
  createResolveHandler,
  createExtractHandler,
  createEnrichHandler,
  createEmbedHandler,
  createRelateHandler,
  createIndexHandler,
  withConcurrencyLimit,
} from './jobs'

export interface PipelineDeps {
  db: DbClient
  enrichProvider: LLMProvider
  embeddingProvider: EmbeddingProvider
  extractors: readonly Extractor[]
}

/** Matched-pair logging (CLAUDE.md's Gen-AI section: "log resolved model + prompt version
 *  together") — bumped whenever prompts/enrichment.v*.md's contract changes. */
const PROMPT_VERSION = 'enrichment.v2'

/** Per-stage concurrency caps (plan P7.9) — see withConcurrencyLimit's own doc comment
 *  (src/worker/jobs/shared.ts) for why these three and not the others. */
const EXTRACT_CONCURRENCY = 2
const ENRICH_CONCURRENCY = 1
const EMBED_CONCURRENCY = 1

function buildExtractors(): Extractor[] {
  return [
    new GithubExtractor(),
    new YoutubeExtractor(),
    new ArticleExtractor(),
    new InstagramExtractor(),
    new XThreadsExtractor(),
    new PdfExtractor(),
  ]
}

async function buildEmbeddingProvider(budget: BudgetManager): Promise<EmbeddingProvider> {
  // `background` lane: a bulk import must never eat the reserve that keeps interactive search and
  // chat working. Same split enrichment already uses.
  const provider = createEmbeddingProviderFromConfig({ budget, lane: 'background' })
  // Only the local provider has anything to warm — it's loading a ~350 MB ONNX model off disk,
  // which is exactly the cost the hosted provider exists to avoid paying. `warmUp` is optional on
  // the interface for that reason; calling it on the hosted provider would be a pointless no-op.
  await provider.warmUp?.()
  return provider
}

/**
 * Idempotent — safe to call more than once (e.g. a dev hot-reload): `getDb()`/`getJobQueue()`/
 * `the embedding provider are each already `globalThis`- or module-level-singleton-guarded,
 * and re-registering the same handlers into `registry` is harmless.
 */
export async function bootstrapPipeline(): Promise<PipelineDeps> {
  const config = getConfig()
  const db = getDb()
  const sqlite = db.$client
  const jobQueue = getJobQueue()
  const settingsPort = createSqliteSettingsPort(sqlite)
  const callLog = createSqliteLlmCallLog(sqlite)

  logger.info('bootstrap: probing OpenRouter model capabilities')
  const capabilityProbe = await createCapabilityProbe({ apiKey: config.openRouterApiKey })

  const budget = new BudgetManager(settingsPort, config.llmDailyCap, config.llmInteractiveReserve)
  const rateLimiter = new TokenBucket({
    capacity: RATE_LIMIT_PER_MINUTE,
    refillPerMinute: RATE_LIMIT_PER_MINUTE,
  })

  const enrichProvider = createEnrichmentProvider({
    apiKey: config.openRouterApiKey,
    chainEnrich: config.llmChainEnrich,
    chainChat: config.llmChainChat,
    capabilityProbe,
    budget,
    rateLimiter,
    callLog,
    promptVersion: PROMPT_VERSION,
  })

  logger.info(
    { provider: config.embeddingProvider, model: config.embeddingModel },
    'bootstrap: building the embedding provider',
  )
  const embeddingProvider = await buildEmbeddingProvider(budget)
  assertEmbeddingModelMatches(embeddingProvider.model, settingsPort)

  const extractors = buildExtractors()

  registerJobHandlers({
    resolve: createResolveHandler({ db, jobQueue }),
    extract: withConcurrencyLimit(
      EXTRACT_CONCURRENCY,
      createExtractHandler({ db, jobQueue, extractors }),
    ),
    enrich: withConcurrencyLimit(
      ENRICH_CONCURRENCY,
      createEnrichHandler({ db, jobQueue, provider: enrichProvider, embeddingProvider }),
    ),
    embed: withConcurrencyLimit(
      EMBED_CONCURRENCY,
      createEmbedHandler({ db, jobQueue, embeddingProvider }),
    ),
    // Dimension comes from the provider that actually wrote the vectors, not a constant — those
    // two must agree or the kNN is rejected outright.
    relate: createRelateHandler({
      db,
      jobQueue,
      embeddingDimensions: embeddingProvider.dimensions,
    }),
    index: createIndexHandler({ db }),
  })

  logger.info('bootstrap: pipeline handlers registered')
  return { db, enrichProvider, embeddingProvider, extractors }
}

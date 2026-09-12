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
 *   `globalThis`-guarded singleton inside `getLocalEmbeddingProvider()` itself, so calling it
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
import {
  getLocalEmbeddingProvider,
  selectEmbeddingProviderFromEnv,
  assertEmbeddingModelMatches,
} from '@/lib/embeddings'
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
} from './jobs'

export interface PipelineDeps {
  db: DbClient
  enrichProvider: LLMProvider
  embeddingProvider: EmbeddingProvider
  extractors: readonly Extractor[]
}

/** Matched-pair logging (CLAUDE.md's Gen-AI section: "log resolved model + prompt version
 *  together") — bumped whenever prompts/enrichment.v1.md's contract changes. */
const PROMPT_VERSION = 'enrichment.v1'

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

async function buildEmbeddingProvider(): Promise<EmbeddingProvider> {
  const kind = selectEmbeddingProviderFromEnv()
  if (kind !== 'local') {
    // CLAUDE.md's stack table and .env.example both commit to the local model as the supported
    // path; the OpenRouter alternative is a documented-but-not-wired opt-in (see
    // src/lib/embeddings/factory.ts's own guard) that needs a dimension count with no safe
    // default — building that out is future work, not this phase's scope. Fail loudly at boot
    // instead of silently running with the wrong provider.
    throw new Error(
      `EMBEDDING_PROVIDER=${kind} is not wired up by the P7 pipeline bootstrap — only 'local' is. ` +
        'See src/lib/embeddings/factory.ts.',
    )
  }
  const provider = getLocalEmbeddingProvider()
  await provider.warmUp()
  return provider
}

/**
 * Idempotent — safe to call more than once (e.g. a dev hot-reload): `getDb()`/`getJobQueue()`/
 * `getLocalEmbeddingProvider()` are each already `globalThis`- or module-level-singleton-guarded,
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

  logger.info('bootstrap: warming the local embedding model')
  const embeddingProvider = await buildEmbeddingProvider()
  assertEmbeddingModelMatches(embeddingProvider.model, settingsPort)

  const extractors = buildExtractors()

  registerJobHandlers({
    resolve: createResolveHandler({ db, jobQueue }),
    extract: createExtractHandler({ db, jobQueue, extractors }),
    enrich: createEnrichHandler({ db, jobQueue, provider: enrichProvider, embeddingProvider }),
    embed: createEmbedHandler({ db, jobQueue, embeddingProvider }),
    relate: createRelateHandler({ db, jobQueue }),
    index: createIndexHandler({ db }),
  })

  logger.info('bootstrap: pipeline handlers registered')
  return { db, enrichProvider, embeddingProvider, extractors }
}

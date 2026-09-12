/**
 * `enrich` (P7.3) — P3's single structured call per item (`enrichItem`): tldr + bullets + tags +
 * topic + kindFields together, one request, never split (CLAUDE.md's Free-Tier Budget). On a
 * budget-exhausted outcome, this RE-QUEUES itself for after the UTC reset instead of failing —
 * "the system must stay useful at zero budget" (ADR 0004) means a paused enrichment is a wait,
 * not a failure. On every other non-throwing failure outcome (the whole model chain came up
 * empty this attempt), it throws so queue.ts's own backoff/retry applies — a 503 or an exhausted
 * per-model sub-limit can clear on its own, so this deserves a real retry, not an instant
 * dead-letter.
 */
import { JobName } from '@/types/contracts'
import type { EnrichJobPayload, EmbeddingProvider, LLMProvider } from '@/types/contracts'
import type { JobQueue } from '@/lib/queue'
import type { DbClient } from '@/db/client'
import { enrichItem } from '@/lib/ai'
import { getItemById, updateEnrichmentResult } from '@/repositories/items'
import { listTopicsForUser, createTopic, setItemTopic } from '@/repositories/topics'
import { setItemTags } from '@/repositories/tags'
import { logger } from '@/lib/logger'
import { runStage } from './shared'
import type { JobHandler } from '../registry'

export interface EnrichHandlerDeps {
  db: DbClient
  jobQueue: JobQueue
  provider: LLMProvider
  embeddingProvider: EmbeddingProvider
}

export function createEnrichHandler(deps: EnrichHandlerDeps): JobHandler<EnrichJobPayload> {
  return async (payload) => {
    const item = getItemById(deps.db, payload.itemId)
    if (!item) {
      throw new Error(`enrich: no item with id ${payload.itemId}`)
    }

    await runStage({ db: deps.db, stage: JobName.Enrich, itemId: item.id }, async () => {
      const existingTopics = listTopicsForUser(deps.db, item.userId)

      const outcome = await enrichItem(
        {
          title: item.title ?? item.canonicalUrl,
          kind: item.kind,
          contentText: item.contentText ?? '',
          extractorKindFields: item.kindFields ?? undefined,
          existingTopics,
        },
        { provider: deps.provider, embeddingProvider: deps.embeddingProvider },
      )

      if (!outcome.ok) {
        if (outcome.reason === 'budget_exhausted') {
          logger.info(
            { itemId: item.id, resetAt: outcome.resetAt },
            'enrich: budget exhausted — re-queuing for after the UTC reset',
          )
          deps.jobQueue.enqueue(
            { name: JobName.Enrich, itemId: item.id },
            { runAt: outcome.resetAt },
          )
          return
        }
        throw new Error(`enrich: ${outcome.detail}`)
      }

      updateEnrichmentResult(deps.db, item.id, {
        summaryTldr: outcome.result.tldr,
        summaryBullets: outcome.result.bullets,
        kindFields: outcome.result.kindFields,
      })
      setItemTags(deps.db, item.userId, item.id, outcome.result.tags)

      const topicId = outcome.topic.isNew
        ? createTopic(deps.db, item.userId, outcome.topic.label).id
        : outcome.topic.topicId
      setItemTopic(deps.db, item.id, topicId, outcome.result.confidence)

      deps.jobQueue.enqueue({ name: JobName.Embed, itemId: item.id })
    })
  }
}

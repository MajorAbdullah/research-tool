/**
 * `embed` (P7.4) — chunks the item's content (P3's chunker) and embeds every chunk in ONE local,
 * zero-request batch call (CLAUDE.md's Free-Tier Budget: embeddings cost nothing, which is what
 * makes both ingest and search free). Deletes any chunks left over from a previous run first, so
 * retrying this stage (P7.7/7.8) replaces rather than duplicates.
 */
import { JobName } from '@/types/contracts'
import type { EmbedJobPayload, EmbeddingProvider } from '@/types/contracts'
import type { JobQueue } from '@/lib/queue'
import type { DbClient } from '@/db/client'
import { chunkContent } from '@/lib/embeddings'
import { getItemById } from '@/repositories/items'
import { deleteChunksForItem, insertChunksWithVectors } from '@/repositories/chunks'
import { runStage } from './shared'
import type { JobHandler } from '../registry'

export interface EmbedHandlerDeps {
  db: DbClient
  jobQueue: JobQueue
  embeddingProvider: EmbeddingProvider
}

export function createEmbedHandler(deps: EmbedHandlerDeps): JobHandler<EmbedJobPayload> {
  return async (payload) => {
    const item = getItemById(deps.db, payload.itemId)
    if (!item) {
      throw new Error(`embed: no item with id ${payload.itemId}`)
    }

    await runStage({ db: deps.db, stage: JobName.Embed, itemId: item.id }, async () => {
      deleteChunksForItem(deps.db, item.id)

      const chunks = chunkContent({
        userId: item.userId,
        title: item.title ?? item.canonicalUrl,
        url: item.canonicalUrl,
        publishedAt: item.publishedAt ?? undefined,
        kind: item.kind,
        contentText: item.contentText ?? '',
      })

      if (chunks.length > 0) {
        const vectors = await deps.embeddingProvider.embed(chunks.map((c) => c.text))
        insertChunksWithVectors(deps.db, {
          itemId: item.id,
          embeddingModel: deps.embeddingProvider.model,
          chunks,
          vectors,
        })
      }

      deps.jobQueue.enqueue({ name: JobName.Relate, itemId: item.id })
    })
  }
}

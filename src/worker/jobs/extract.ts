/**
 * `extract` (P7.2) — runs P2's extractor for the item's kind and persists the result. A degraded
 * tier is success, never failure: CLAUDE.md's "never let extraction failure look like success"
 * cuts the other way too, a *lower* tier must never be treated as an error. A YouTube 429 simply
 * resolves as `extractionTier: 'partial'` (P2's ladder guarantees this, see ladder.ts) and the
 * pipeline continues exactly as it would for a `full` result.
 *
 * The extractor to use is picked by `matches(url)`, not by `kind` alone — `kind='social'` covers
 * both Instagram and X/Threads (see classify.ts's own header comment) — `bootstrap.ts` constructs
 * the ordered list this handler picks from. A kind with no registered extractor at all (`audio`,
 * `other` — see classify.ts) falls back to a local, I/O-free `metadata_only` result, the same
 * ceiling P2's own ladders fall back to on total failure.
 */
import { JobName, ExtractionTier } from '@/types/contracts'
import type { ExtractJobPayload, Extractor, ExtractedContent } from '@/types/contracts'
import type { JobQueue } from '@/lib/queue'
import type { DbClient } from '@/db/client'
import { getItemById, updateExtractionResult } from '@/repositories/items'
import { runStage } from './shared'
import type { JobHandler } from '../registry'

function fallbackTitle(url: string): string {
  try {
    const { pathname } = new URL(url)
    const last = pathname.split('/').filter(Boolean).pop()
    return last ? decodeURIComponent(last) : url
  } catch {
    return url
  }
}

export interface ExtractHandlerDeps {
  db: DbClient
  jobQueue: JobQueue
  extractors: readonly Extractor[]
}

export function createExtractHandler(deps: ExtractHandlerDeps): JobHandler<ExtractJobPayload> {
  return async (payload) => {
    const item = getItemById(deps.db, payload.itemId)
    if (!item) {
      throw new Error(`extract: no item with id ${payload.itemId}`)
    }

    await runStage({ db: deps.db, stage: JobName.Extract, itemId: item.id }, async () => {
      const extractor = deps.extractors.find((e) => e.matches(item.canonicalUrl))

      const content: ExtractedContent = extractor
        ? await extractor.extract(item.canonicalUrl, payload.hint)
        : {
            contentText: item.title ?? fallbackTitle(item.canonicalUrl),
            extractionTier: ExtractionTier.MetadataOnly,
          }

      updateExtractionResult(deps.db, item.id, {
        contentText: content.contentText,
        extractionTier: content.extractionTier,
        title: content.title,
        author: content.author,
        publishedAt: content.publishedAt,
        thumbnailUrl: content.thumbnailUrl,
        kindFields: content.kindFields,
        rawPayload: content.rawPayload,
      })

      deps.jobQueue.enqueue({ name: JobName.Enrich, itemId: item.id })
    })
  }
}

/**
 * `relate` (P7.5) — item-level mean embedding (P9.2.1) -> kNN over `chunk_vec`, pre-filtered to
 * the same user and excluding the item's own chunks (CLAUDE.md: access control filters BEFORE the
 * kNN — see repositories/relations.ts for how that's done against a virtual table with no
 * `user_id` column of its own). Every relation this stage writes gets the neutral type `similar`
 * and no rationale: TYPE labeling (`alternative` / `supersedes` / a rationale) is a separate,
 * batched LLM sweep (P9.2.2, ADR 0004 — "~0.05 requests/item", never per-item), so `relate` makes
 * ZERO LLM calls and zero embedding-provider calls of its own; it only reads vectors `embed`
 * already computed and stored.
 */
import { JobName, RelationType } from '@/types/contracts'
import type { RelateJobPayload } from '@/types/contracts'
import type { JobQueue } from '@/lib/queue'
import type { DbClient } from '@/db/client'
import { getItemById } from '@/repositories/items'
import { meanVectorForItem } from '@/repositories/chunks'
import { findNearestItemsByVector, insertRelationIfAbsent } from '@/repositories/relations'
import { runStage } from './shared'
import type { JobHandler } from '../registry'

/**
 * Max L2 distance for two items to be considered related at all. bge-small-en-v1.5's vectors are
 * approximately unit-normalized, which bounds L2 distance between them to roughly [0, 2] (0
 * identical, 2 exactly opposite: distance^2 = 2 - 2*cosine_similarity). A starting point, like
 * topic-assignment.ts's own threshold — P9.1.7's golden-set eval is where this gets tuned against
 * real precision/recall, not a value to treat as load-bearing on its own.
 */
export const DEFAULT_RELATION_DISTANCE_THRESHOLD = 0.9
export const MAX_RELATIONS_PER_ITEM = 5

function distanceToScore(distance: number): number {
  return Math.max(0, Math.min(1, 1 - distance / 2))
}

export interface RelateHandlerDeps {
  db: DbClient
  jobQueue: JobQueue
  /**
   * Width of the vectors in `chunk_vec`, i.e. the configured embedding model's dimension.
   *
   * Injected rather than imported as a constant: this used to be `LOCAL_EMBEDDING_DIMENSIONS`
   * (384), which silently became wrong the moment the deployment moved to a 2048-d hosted model —
   * `meanVectorForItem` built a 384-float vector and sqlite-vec rejected the kNN with
   * "Dimension mismatch ... Expected 2048 dimensions but received 384", failing every item at the
   * relate stage after extract/enrich/embed had all succeeded.
   */
  embeddingDimensions: number
}

export function createRelateHandler(deps: RelateHandlerDeps): JobHandler<RelateJobPayload> {
  return async (payload) => {
    const item = getItemById(deps.db, payload.itemId)
    if (!item) {
      throw new Error(`relate: no item with id ${payload.itemId}`)
    }

    await runStage({ db: deps.db, stage: JobName.Relate, itemId: item.id }, async () => {
      const meanVector = meanVectorForItem(deps.db, item.id, deps.embeddingDimensions)

      if (meanVector) {
        const neighbors = findNearestItemsByVector(deps.db, {
          queryVector: meanVector,
          userId: item.userId,
          excludeItemId: item.id,
          topN: MAX_RELATIONS_PER_ITEM,
        })

        for (const neighbor of neighbors) {
          if (neighbor.distance > DEFAULT_RELATION_DISTANCE_THRESHOLD) continue
          insertRelationIfAbsent(deps.db, {
            itemA: item.id,
            itemB: neighbor.itemId,
            type: RelationType.Similar,
            score: distanceToScore(neighbor.distance),
          })
        }
      }

      deps.jobQueue.enqueue({ name: JobName.Index, itemId: item.id })
    })
  }
}

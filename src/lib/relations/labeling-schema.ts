/**
 * The Zod schema for the batched relation-labeling sweep's structured output (P9.2.2) — one
 * request, up to 20 pairs.
 */

import { z } from 'zod'
import { RelationType } from '@/types/contracts'

const RELATION_TYPE_VALUES = Object.values(RelationType) as [RelationType, ...RelationType[]]

/** P9.2.2's batch ceiling, mirrored here so the schema itself rejects an oversized response
 *  rather than relying only on `pending-pairs.ts`'s input-side cap. */
export const MAX_LABELS_PER_SWEEP = 20

/**
 * The model returns a label ONLY for pairs it's confident about — omitting a `pairIndex` leaves
 * that pair pending for a future sweep rather than forcing a low-confidence guess into a fixed
 * 3-way enum (there is no "unrelated"/"unsure" value in `relations.type`'s CHECK constraint, and
 * this phase doesn't get to add one).
 */
export const relationLabelSetSchema = z.object({
  labels: z
    .array(
      z.object({
        pairIndex: z.number().int().min(0),
        type: z.enum(RELATION_TYPE_VALUES),
        rationale: z.string().trim().min(1).max(300),
      }),
    )
    .max(MAX_LABELS_PER_SWEEP),
})

export type RelationLabelSet = z.infer<typeof relationLabelSetSchema>
export type RelationLabel = RelationLabelSet['labels'][number]

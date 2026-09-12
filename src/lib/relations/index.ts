/**
 * Public surface of the relations layer — what P7's worker (the `relate` job stage) is expected
 * to import to wire up neighbour computation and the batched labeling sweep. Every module is
 * directly importable too; this barrel is the one-stop wiring surface, mirroring `@/lib/ai`'s and
 * `@/lib/search`'s own barrels.
 */

export {
  computeMeanEmbedding,
  findItemNeighbors,
  similarityFromDistance,
  type ItemNeighbor,
  type FindItemNeighborsOptions,
} from './neighbors'

export {
  collectPendingPairs,
  DEFAULT_MAX_PENDING_PAIRS,
  DEFAULT_NEIGHBORS_PER_ITEM,
  type PendingPair,
  type CollectPendingPairsOptions,
} from './pending-pairs'

export {
  relationLabelSetSchema,
  MAX_LABELS_PER_SWEEP,
  type RelationLabelSet,
  type RelationLabel,
} from './labeling-schema'

export { labelPendingPairs, type LabeledPair, type LabelingOutcome } from './labeling'

export { storeLabeledRelations, type StoreRelationsResult } from './store'

export { runRelationSweep, type RelationSweepOutcome, type RunRelationSweepOptions } from './sweep'

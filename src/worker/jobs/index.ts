/**
 * Barrel export for the six pipeline stage handlers (P7). `bootstrap.ts` is the only production
 * caller; tests import individual `createXHandler` factories directly or through here.
 */
export { createResolveHandler, type ResolveHandlerDeps } from './resolve'
export { createExtractHandler, type ExtractHandlerDeps } from './extract'
export { createEnrichHandler, type EnrichHandlerDeps } from './enrich'
export { createEmbedHandler, type EmbedHandlerDeps } from './embed'
export {
  createRelateHandler,
  type RelateHandlerDeps,
  DEFAULT_RELATION_DISTANCE_THRESHOLD,
  MAX_RELATIONS_PER_ITEM,
} from './relate'
export { createIndexHandler, type IndexHandlerDeps } from './index-stage'
export { runStage, isLastAttempt, currentAttempt, type RunStageOptions } from './shared'

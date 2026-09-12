/**
 * Public surface of the search layer — what `src/app/api/v1/search/route.ts` and `@/lib/relations`
 * (item-neighbour kNN reuses `vectorSearch`) import. Every module is directly importable too; this
 * barrel is the one-stop wiring surface, mirroring `@/lib/ai`'s and `@/lib/embeddings`'s own
 * barrels.
 */

export { tokenizeForFts, buildFtsMatchExpression, MAX_FTS_TERMS } from './fts-sanitize'

export { buildItemFilterFragment, type SearchFilters, type SqlFragment } from './filters'

export { reciprocalRankFusion, DEFAULT_RRF_K, type RankedIds, type FusedResult } from './rrf'

export { vectorSearch, type VectorSearchHit, type VectorSearchOptions } from './vector-search'

export { ftsSearch, ftsSnippet, type FtsSearchHit, type FtsSearchOptions } from './fts-search'

export {
  encodeSearchCursor,
  decodeSearchCursor,
  paginateFused,
  type SearchCursor,
} from './pagination'

export {
  loadItemSummaryRows,
  toItemWireId,
  type SearchResultItem,
  type WireTopic,
  type ItemSummaryBase,
} from './item-summary'

export {
  hybridSearch,
  ftsOnlySearch,
  clampLimit,
  DEFAULT_CANDIDATE_POOL_SIZE,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  type HybridSearchOptions,
  type SearchPage,
} from './hybrid-search'

export { parseSearchQuery, type ParsedSearchQuery } from './query-schema'

export {
  apiError,
  generateRequestId,
  type SearchApiErrorCode,
  type ApiErrorDetails,
} from './api-errors'

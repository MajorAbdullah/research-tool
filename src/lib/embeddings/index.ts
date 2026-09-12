/**
 * Public surface of the embeddings layer — what P7 (the `embed` job stage) and P9 (hybrid search)
 * import. Every module is directly importable too; this barrel is the one-stop wiring surface.
 */

export {
  chunkContent,
  TARGET_CHUNK_TOKENS,
  CHUNK_OVERLAP_RATIO,
  SHORT_ITEM_TOKEN_THRESHOLD,
  type ChunkInput,
  type ChunkResult,
  type ChunkSourceMetadata,
} from './chunker'

export { Semaphore } from './concurrency'

export {
  LocalEmbeddingProvider,
  getLocalEmbeddingProvider,
  LOCAL_EMBEDDING_MODEL_ID,
  LOCAL_EMBEDDING_DIMENSIONS,
  type LocalEmbeddingProviderOptions,
  type FastEmbedModel,
} from './local-provider'

export {
  OpenRouterEmbeddingProvider,
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  type OpenRouterEmbeddingProviderOptions,
} from './openrouter-provider'

export {
  createEmbeddingProvider,
  selectEmbeddingProviderFromEnv,
  type EmbeddingProviderKind,
  type EmbeddingProviderSelection,
} from './factory'

export {
  assertEmbeddingModelMatches,
  recordEmbeddingModel,
  EmbeddingModelMismatchError,
  EMBEDDING_MODEL_SETTINGS_KEY,
} from './settings-guard'

export {
  reembedAll,
  type ReembedDb,
  type ReembedDeps,
  type ReembedResult,
  type ChunkRow,
} from './reembed'

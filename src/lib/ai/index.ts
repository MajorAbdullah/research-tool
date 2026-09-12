/**
 * Public surface of the AI provider layer — what other phases (P7's ingest pipeline, P9's
 * relation-labeling sweep, P13's chat) import. Every individual module remains directly
 * importable too (`@/lib/ai/provider`, etc.); this barrel exists so a caller wiring the whole
 * layer together (P7's job handlers in particular) doesn't need to know the exact file each of
 * ~15 pieces lives in.
 */

export { loadAiConfig, RATE_LIMIT_PER_MINUTE, type AiConfig } from './config'

export {
  BudgetExhaustedError,
  ChainExhaustedError,
  SchemaValidationError,
  ModelRefusalError,
  LlmTimeoutError,
  OpenRouterHttpError,
  RETRYABLE_HTTP_STATUSES,
  type ChainAttemptFailure,
} from './errors'

export { TokenBucket, type TokenBucketOptions } from './rate-limiter'

export {
  createSqliteSettingsPort,
  createInMemorySettingsPort,
  type SettingsPort,
  type SqliteLike,
  type PreparedStatementLike,
} from './settings-store'

export {
  BudgetManager,
  type BudgetLane,
  type BudgetReservation,
  type BudgetExhausted,
  type BudgetReserveResult,
  type BudgetStatus,
} from './budget'

export {
  createSqliteLlmCallLog,
  createInMemoryLlmCallLog,
  type LlmCallLog,
  type LlmCallRecord,
} from './llm-call-log'

export {
  CapabilityProbe,
  createCapabilityProbe,
  fetchModelCapabilities,
  deriveSchemaStrategy,
  type ModelCapability,
  type FetchModelCapabilitiesOptions,
} from './capability-probe'

export type { FetchLike } from './openrouter-client'

export {
  OpenRouterProvider,
  createEnrichmentProvider,
  createChatProvider,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_COMPLETE_MAX_TOKENS,
  DEFAULT_STRUCTURED_MAX_TOKENS,
  type CreateProviderDeps,
  type OpenRouterProviderOptions,
} from './provider'

export { loadPrompt, clearPromptCache, type LoadedPrompt } from './prompts'

export {
  wrapUntrustedContent,
  stripInjectedDelimiters,
  UNTRUSTED_CONTENT_TAG,
} from './prompt-safety'

export {
  enrichmentResultSchema,
  repoKindFieldsSchema,
  buildEnrichmentSchema,
  TAG_COUNT_MIN,
  TAG_COUNT_MAX,
  BULLET_COUNT_MIN,
  BULLET_COUNT_MAX,
} from './enrichment-schema'

export {
  assignTopic,
  DEFAULT_TOPIC_DISTANCE_THRESHOLD,
  type ExistingTopic,
  type TopicAssignment,
} from './topic-assignment'

export {
  enrichItem,
  type EnrichmentInput,
  type EnrichmentDeps,
  type EnrichOutcome,
  type EnrichmentMeta,
} from './enrichment'

export { estimateTokens, tokenBudgetToChars } from './token-estimate'

export { truncateToTokenBudget, type TruncationResult } from './truncate'

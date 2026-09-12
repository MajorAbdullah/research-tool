/**
 * Public surface of the chat/RAG pipeline — what `src/app/api/v1/chat/route.ts` and
 * `eval/generation/**` import. Every module is directly importable too; this barrel mirrors
 * `@/lib/search` and `@/lib/ai`'s own barrel convention.
 */

export type {
  ChatFilters,
  ChatSource,
  RetrievedChunkLogEntry,
  ContextBlock,
  CandidateChunk,
  CandidateItem,
  RetrieveRawResult,
  AssembledContext,
  ConversationTurn,
} from './types'

export {
  retrieveCandidates,
  DEFAULT_MAX_ITEMS,
  DEFAULT_MAX_CHUNKS_PER_ITEM,
  type RetrieveDeps,
  type RetrieveOptions,
} from './retrieve'

export {
  assembleContext,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  type AssembleContextOptions,
} from './context-assembly'

export {
  isPreGenerationGrounded,
  INSUFFICIENT_CONTEXT_MESSAGE,
  VECTOR_DISTANCE_CEILING,
  type GroundednessSignal,
} from './groundedness'

export {
  extractCitationIndices,
  validateCitations,
  looksLikeRefusal,
  type CitationValidation,
} from './citations'

export {
  buildChatMessages,
  buildCitationRetryMessages,
  type BuildChatMessagesInput,
  type PromptMeta,
} from './prompt'

export { generateGroundedAnswer, type GenerateAnswerResult } from './generate'

export { splitIntoStreamChunks } from './stream-chunks'

export { formatSseEvent } from './sse'

export { computeCacheKey, getCachedAnswer, setCachedAnswer, type CachedChatAnswer } from './cache'

export {
  getOrCreateConversation,
  loadHistory,
  appendUserMessage,
  appendAssistantMessage,
  toConversationWireId,
  toMessageWireId,
  type ConversationHandle,
  type AppendUserMessageInput,
  type AppendAssistantMessageInput,
} from './conversation-store'

export { parseItemWireId, parseConversationWireId } from './ids'

export {
  apiError,
  buildApiErrorBody,
  generateRequestId,
  type ChatApiErrorCode,
  type ApiErrorDetails,
  type ApiErrorBody,
} from './api-errors'

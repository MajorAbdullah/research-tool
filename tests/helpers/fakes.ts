/**
 * Fakes for P7's job-handler and pipeline-integration tests — never the network (CLAUDE.md /
 * qa-testing-best-practices.md: "mock at architectural boundaries"). Both satisfy the exact
 * frozen `contracts.ts` provider interfaces, so a stage handler under test can't tell the
 * difference from the real P3 providers it gets at runtime via `src/worker/bootstrap.ts`.
 *
 * NOT a test file itself (no `.test.ts` suffix) — same convention as
 * `tests/unit/test-helpers/scratch-db.ts`.
 */
import type {
  EmbeddingProvider,
  LLMCallOptions,
  LLMCompletion,
  LLMMessage,
  LLMProvider,
  LLMStructuredResult,
} from '@/types/contracts'
import type { ZodType } from 'zod'
import { EMBEDDING_DIMS } from './db'

export const FAKE_EMBEDDING_MODEL = 'fake-embed-test'

function hashSeed(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0
  }
  return Math.abs(h) % 97 || 1
}

/**
 * Deterministic per-text vector: the same text always embeds to the same vector, and near-
 * identical text lands close in the space (same seed modulus), without importing any real
 * embedding model. Good enough to exercise chunk_vec's kNN and topic-assignment's cosine
 * similarity meaningfully in tests.
 */
function vectorFor(text: string): number[] {
  const seed = hashSeed(text)
  return Array.from({ length: EMBEDDING_DIMS }, (_, i) => Math.sin((i + 1) * seed * 0.017))
}

export function createFakeEmbeddingProvider(): EmbeddingProvider {
  return {
    model: FAKE_EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMS,
    async embed(texts: string[]) {
      return texts.map(vectorFor)
    },
    async embedQuery(text: string) {
      return vectorFor(text)
    },
  }
}

export interface FakeLlmProviderOptions {
  /** Called once per `structured()` invocation. Return the schema-shaped payload the caller
   *  expects, or throw (e.g. `new BudgetExhaustedError(...)`, imported from `@/lib/ai`) to
   *  simulate that failure mode exactly as the real `OpenRouterProvider` would. */
  structured: (messages: LLMMessage[]) => unknown
  complete?: (messages: LLMMessage[]) => string
}

/** A minimal `LLMProvider` double. Casts its script's `unknown` return to the caller's generic
 *  `T` — a normal, contained pattern for a test fake satisfying a generic interface method, not a
 *  use of `any`. */
export function createFakeLlmProvider(options: FakeLlmProviderOptions): LLMProvider {
  return {
    async complete(messages: LLMMessage[], _options?: LLMCallOptions): Promise<LLMCompletion> {
      const text = options.complete ? options.complete(messages) : ''
      return { text, modelRequested: 'fake-model', modelResolved: 'fake-model', promptTokens: 0, completionTokens: 0 }
    },
    async structured<T>(
      messages: LLMMessage[],
      _schema: ZodType<T>,
      _callOptions?: LLMCallOptions,
    ): Promise<LLMStructuredResult<T>> {
      const data = options.structured(messages) as T
      return {
        data,
        modelRequested: 'fake-model',
        modelResolved: 'fake-model',
        promptTokens: 10,
        completionTokens: 10,
        schemaStrategy: 'response_format',
      }
    },
  }
}

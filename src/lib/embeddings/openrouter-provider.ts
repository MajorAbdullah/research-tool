/**
 * Alternate `EmbeddingProvider` behind the same interface, backed by OpenRouter instead of the
 * local model (P3.3.6). Documented as trading free-tier request quota for the ~350 MB of RAM the
 * local model costs — NOT the default (`EMBEDDING_PROVIDER=local` is), and switching to it
 * requires a deliberate `pnpm reembed`, never an automatic fallback (ADR 0003).
 *
 * Every embed call here spends real OpenRouter requests — including, unlike the local provider,
 * every single search query. That's the whole tradeoff this file exists to document, not a bug:
 * ADR 0003 estimates 30 searches = 30 requests gone before a single item is even enriched, which
 * is exactly why this isn't the default.
 *
 * `dimensions` has no built-in default here, unlike the local provider's fixed 384. ADR 0003 is
 * explicit about why: "the local model's output dimension is a known constant ... unlike an API
 * model whose dimensions aren't guaranteed documented." Hardcoding a guessed number for a model
 * this code has never actually called would risk silently wiring up a `vec0` schema for the wrong
 * width. Whoever enables this path must supply the dimension for whichever OpenRouter embedding
 * model they've configured, verified against OpenRouter's own catalog at the time.
 */

import type { EmbeddingProvider } from '@/types/contracts'

/** Per the plan's model table (§5.3) — purpose-built for retrieval/RAG/code retrieval, $0. */
export const DEFAULT_OPENROUTER_EMBEDDING_MODEL = 'nvidia/nemotron-3-embed-1b:free'

const EMBEDDINGS_ENDPOINT = 'https://openrouter.ai/api/v1/embeddings'
const DEFAULT_TIMEOUT_MS = 15_000

/** A single-signature stand-in for the global `fetch` — see `src/lib/ai/openrouter-client.ts`'s
 *  `FetchLike` for why: an overloaded `typeof fetch` fails structural assignability against a
 *  plain test mock. Duplicated here (rather than imported across the ai/embeddings boundary) as a
 *  one-line type alias that isn't worth a cross-module dependency for. */
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface OpenRouterEmbeddingProviderOptions {
  apiKey: string
  /** Required — see this file's header comment. No safe default to fall back to. */
  dimensions: number
  model?: string
  fetchImpl?: FetchLike
  timeoutMs?: number
  /**
   * Some retrieval-tuned embedding models (the BGE/E5 family conventions) expect a different
   * instruction prefix on the query side than on the passage side — the same asymmetry
   * `EmbeddingProvider.embedQuery()` exists to express (see contracts.ts). Left unset by default
   * because this project has not verified what, if anything, OpenRouter's specific embedding
   * models expect here; set it if the configured model's own documentation specifies one.
   */
  queryInstructionPrefix?: string
}

interface OpenRouterEmbeddingDatum {
  embedding: number[]
  index: number
}

interface OpenRouterEmbeddingsResponse {
  data: OpenRouterEmbeddingDatum[]
  model: string
}

export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  readonly model: string
  readonly dimensions: number
  private readonly apiKey: string
  private readonly fetchImpl: FetchLike
  private readonly timeoutMs: number
  private readonly queryInstructionPrefix: string | undefined

  constructor(options: OpenRouterEmbeddingProviderOptions) {
    this.model = options.model ?? DEFAULT_OPENROUTER_EMBEDDING_MODEL
    this.dimensions = options.dimensions
    this.apiKey = options.apiKey
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.queryInstructionPrefix = options.queryInstructionPrefix
  }

  /** Array-batched, deliberately — one request for N chunks, not N requests (CLAUDE.md's batching
   *  non-negotiable applies just as much here as it does to the free local path). */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    return this.callEmbeddingsApi(texts)
  }

  async embedQuery(text: string): Promise<number[]> {
    const input = this.queryInstructionPrefix ? `${this.queryInstructionPrefix}${text}` : text
    const vectors = await this.callEmbeddingsApi([input])
    const vector = vectors[0]
    if (!vector) {
      throw new Error(`OpenRouter embeddings response for '${this.model}' returned no vector`)
    }
    return vector
  }

  private async callEmbeddingsApi(input: string[]): Promise<number[][]> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await this.fetchImpl(EMBEDDINGS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: this.model, input }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '')
        throw new Error(
          `OpenRouter embeddings request for '${this.model}' failed (${res.status}): ${bodyText.slice(0, 300)}`,
        )
      }
      const body = (await res.json()) as OpenRouterEmbeddingsResponse
      // Defensive re-sort by index: batched embedding APIs are not universally guaranteed to
      // return rows in request order.
      return [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding)
    } finally {
      clearTimeout(timer)
    }
  }
}

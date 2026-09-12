/**
 * Sieve's frozen P0 contracts: enums, extraction/LLM/embedding provider interfaces, the job
 * pipeline's discriminated union, and the enrichment output shape.
 *
 * This is the ONLY place these types are defined. `src/db/schema.ts` imports the enums from here
 * (as TS types, plus a couple of values for column defaults) rather than redeclaring them, and
 * every other phase (P2 extractors, P3 AI layer, P7 pipeline, P9 search, P13 chat) builds against
 * this file instead of each other's implementation code.
 *
 * Wire-format note: these are the *internal* (DB/TS) shapes. `docs/API.md` defines the separate
 * HTTP contract — the two intentionally use the same string values for the enums they share, but
 * are not required to be identical (e.g. the HTTP layer has no reason to expose `JobPayload`).
 */

import type { ZodType } from 'zod'

/**
 * Epoch milliseconds, UTC. Every timestamp in this codebase is one of these — never a Date,
 * never an ISO string.
 */
export type UtcMillis = number

// ---------------------------------------------------------------------------
// Enums — each is a const object (for the runtime values code needs, e.g.
// column defaults and switch cases) plus a derived union type of the same
// name (for annotations). Import the type, or the value, or both, as needed.
// ---------------------------------------------------------------------------

export const ItemKind = {
  Github: 'github',
  Video: 'video',
  Article: 'article',
  Social: 'social',
  Pdf: 'pdf',
  Audio: 'audio',
  Other: 'other',
} as const
export type ItemKind = (typeof ItemKind)[keyof typeof ItemKind]

export const ItemStatus = {
  Queued: 'queued', // pipeline-owned: captured, not yet picked up
  Processing: 'processing', // pipeline-owned: a job stage is running
  Inbox: 'inbox', // pipeline finished, unreviewed — first board column
  ToTest: 'to_test',
  Testing: 'testing',
  Tested: 'tested',
  Archived: 'archived',
  Dropped: 'dropped',
  Failed: 'failed', // pipeline-owned: permanent error, see failure_reason
} as const
export type ItemStatus = (typeof ItemStatus)[keyof typeof ItemStatus]

export const ExtractionTier = {
  Full: 'full',
  Partial: 'partial',
  MetadataOnly: 'metadata_only',
} as const
export type ExtractionTier = (typeof ExtractionTier)[keyof typeof ExtractionTier]

/**
 * Matches docs/API.md's `SourceSurface` exactly — this travels client → capture body → job
 * payload unchanged.
 */
export const SourceSurface = {
  Extension: 'extension',
  Pwa: 'pwa',
  Web: 'web',
  Import: 'import',
} as const
export type SourceSurface = (typeof SourceSurface)[keyof typeof SourceSurface]

export const RelationType = {
  Alternative: 'alternative',
  Similar: 'similar',
  Supersedes: 'supersedes',
} as const
export type RelationType = (typeof RelationType)[keyof typeof RelationType]

/**
 * A single job row's lifecycle: queued -> active -> completed, or -> failed once retries are
 * exhausted.
 */
export const JobState = {
  Queued: 'queued',
  Active: 'active',
  Completed: 'completed',
  Failed: 'failed',
} as const
export type JobState = (typeof JobState)[keyof typeof JobState]

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * The browser-extension capture payload — whatever the client could grab that the server,
 * running on a datacenter IP, cannot.
 */
export interface ClientCapture {
  html?: string
  transcript?: string
  caption?: string
}

export interface ExtractedContent {
  contentText: string
  extractionTier: ExtractionTier
  title?: string
  author?: string
  publishedAt?: UtcMillis
  thumbnailUrl?: string
  /**
   * Extractor-derived fields for this kind (e.g. repo: language/stars/license/lastCommit).
   * Merged with the LLM's kindFields at enrich time.
   */
  kindFields?: Record<string, unknown>
  /**
   * The raw response the extractor got (API JSON, oEmbed payload, etc.), stored to
   * items.raw_payload for debugging and re-derivation without re-fetching.
   */
  rawPayload?: unknown
}

export interface Extractor {
  readonly kind: ItemKind
  matches(url: string): boolean
  extract(url: string, hint?: ClientCapture): Promise<ExtractedContent>
}

// ---------------------------------------------------------------------------
// LLM provider
// ---------------------------------------------------------------------------

/**
 * Only 6 of OpenRouter's 22 free chat models enforce a JSON schema natively. The adapter probes
 * `supported_parameters` at boot and picks one of these per model — callers of `structured()`
 * don't need to know which; they just get validated `T` back.
 */
export type SchemaStrategy = 'response_format' | 'tool_call' | 'prompt_repair'

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMCallOptions {
  /** A hung provider must never hang the caller — required, not optional-in-practice. */
  timeoutMs?: number
  /**
   * Per-task cap (enrichment and chat have very different budgets); never a single global
   * default.
   */
  maxTokens?: number
}

interface LLMCallMeta {
  /** The model configured in the chain, before any provider-side substitution. */
  modelRequested: string
  /**
   * What the provider actually used — `:free` aliases move; this is what gets logged to
   * llm_calls and diffed against modelRequested.
   */
  modelResolved: string
  promptTokens: number
  completionTokens: number
}

export interface LLMCompletion extends LLMCallMeta {
  text: string
}

export interface LLMStructuredResult<T> extends LLMCallMeta {
  data: T
  schemaStrategy: SchemaStrategy
}

export interface LLMProvider {
  complete(messages: LLMMessage[], options?: LLMCallOptions): Promise<LLMCompletion>
  /**
   * `schema` is a Zod schema: it both describes the JSON shape for response_format/tool_call
   * and validates the result for prompt_repair.
   */
  structured<T>(
    messages: LLMMessage[],
    schema: ZodType<T>,
    options?: LLMCallOptions,
  ): Promise<LLMStructuredResult<T>>
}

// ---------------------------------------------------------------------------
// Embedding provider
// ---------------------------------------------------------------------------

export interface EmbeddingProvider {
  /**
   * e.g. 'bge-small-en-v1.5' or 'nvidia/nemotron-3-embed-1b:free' — compared against
   * settings.embedding_model at startup; a mismatch must fail loudly, never silently re-embed
   * with the wrong model.
   */
  readonly model: string
  readonly dimensions: number
  /**
   * Array-batched, deliberately — one call for N texts, not N calls, both for local throughput
   * and to keep the OpenRouter alternative cheap on quota.
   */
  embed(texts: string[]): Promise<number[][]>
}

// ---------------------------------------------------------------------------
// Job pipeline
// ---------------------------------------------------------------------------

export const JobName = {
  Resolve: 'resolve',
  Extract: 'extract',
  Enrich: 'enrich',
  Embed: 'embed',
  Relate: 'relate',
  Index: 'index',
} as const
export type JobName = (typeof JobName)[keyof typeof JobName]

/** Pipeline order — each stage enqueues the next on success (P7). */
export const JOB_PIPELINE: readonly JobName[] = [
  JobName.Resolve,
  JobName.Extract,
  JobName.Enrich,
  JobName.Embed,
  JobName.Relate,
  JobName.Index,
]

/**
 * `resolve` is the one stage that runs before an `items` row exists — it carries the raw
 * capture input instead of an itemId.
 */
export interface ResolveJobPayload {
  name: typeof JobName.Resolve
  url: string
  surface: SourceSurface
  note?: string
  hint?: ClientCapture
}

export interface ExtractJobPayload {
  name: typeof JobName.Extract
  itemId: number
  /**
   * Present on the initial run and on a manual "Re-extract" with fresh client capture; absent
   * on an automatic retry, which re-reads whatever's already stored.
   */
  hint?: ClientCapture
}

export interface EnrichJobPayload {
  name: typeof JobName.Enrich
  itemId: number
}

export interface EmbedJobPayload {
  name: typeof JobName.Embed
  itemId: number
}

export interface RelateJobPayload {
  name: typeof JobName.Relate
  itemId: number
}

export interface IndexJobPayload {
  name: typeof JobName.Index
  itemId: number
}

/**
 * Discriminated on `name` — exhaustively switchable, and mirrors `jobs.name` so a worker can
 * dispatch without a lookup table.
 */
export type JobPayload =
  | ResolveJobPayload
  | ExtractJobPayload
  | EnrichJobPayload
  | EmbedJobPayload
  | RelateJobPayload
  | IndexJobPayload

// ---------------------------------------------------------------------------
// Enrichment
// ---------------------------------------------------------------------------

/**
 * The single enrichment LLM call's output (P3.2.1: one request produces all of this together).
 * `bullets` is 3-5 items, `tags` is 3-8 — enforced by P3's Zod layer, not encoded as TS bounds
 * here.
 *
 * `status` is deliberately NOT a field on this type. The model must never be able to move an item
 * through the research-status workflow (an item can't mark itself "tested") — see CLAUDE.md,
 * "The LLM can never set status." Keeping it off this type means there is no status value for a
 * careless caller to accidentally persist; the omission is structural, not just a convention.
 */
export interface EnrichmentResult {
  tldr: string
  bullets: string[]
  tags: string[]
  topic: string
  confidence: number
  kindFields?: Record<string, unknown>
}

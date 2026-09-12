/**
 * The single enrichment call (P3.2.1, ADR 0004): one structured request per item returns
 * `{tldr, bullets, tags, topic, confidence, kindFields?}` together — never split into separate
 * calls, since requests-per-item is the primary budget constraint (CLAUDE.md "The Free-Tier
 * Budget"). This module is the orchestration layer above the frozen `LLMProvider`: it assembles
 * the delimited prompt (P3.2.1b), selects the per-kind schema, resolves the topic assignment
 * (P3.2.3), merges extractor-derived `kindFields` with the model's own, and turns the two
 * provider-level failure modes that must never crash a request (`BudgetExhaustedError`,
 * `ChainExhaustedError`/`SchemaValidationError`) into a plain, non-throwing result the caller
 * (P7's `enrich` job handler) can act on directly.
 */

import type {
  EmbeddingProvider,
  EnrichmentResult,
  ItemKind,
  LLMMessage,
  LLMProvider,
  UtcMillis,
} from '@/types/contracts'
import { ItemKind as ItemKindValues } from '@/types/contracts'
import { loadPrompt } from './prompts'
import { wrapUntrustedContent } from './prompt-safety'
import { buildEnrichmentSchema } from './enrichment-schema'
import { assignTopic, type ExistingTopic, type TopicAssignment } from './topic-assignment'
import { truncateToTokenBudget } from './truncate'
import { BudgetExhaustedError, ChainExhaustedError, SchemaValidationError } from './errors'

export interface EnrichmentInput {
  title: string
  kind: ItemKind
  contentText: string
  /** Extractor-derived fields for this kind (repo: language/stars/license/last_commit — see
   *  contracts.ts's `ExtractedContent.kindFields` doc). Merged with the model's own `kindFields`
   *  after validation; never sent to the model as something to reproduce. */
  extractorKindFields?: Record<string, unknown>
  /** The user's current topic set, freshly loaded by the caller — used to steer the model's
   *  choice and to resolve its proposal against what already exists (P3.2.3). */
  existingTopics: ExistingTopic[]
}

export interface EnrichmentDeps {
  provider: LLMProvider
  embeddingProvider: EmbeddingProvider
  topicDistanceThreshold?: number
  /** Safety clamp against content too large for even the largest configured chat-chain model —
   *  see truncate.ts. The long-content router (provider.ts) already picks the best-fitting chain
   *  dynamically from the capability probe; this is the last-resort floor beneath that, so it
   *  intentionally doesn't need the probe itself — just a conservative constant. */
  maxInputTokens?: number
}

export interface EnrichmentMeta {
  modelRequested: string
  modelResolved: string
  promptVersion: string
  promptTokens: number
  completionTokens: number
}

export type EnrichOutcome =
  | { ok: true; result: EnrichmentResult; topic: TopicAssignment; meta: EnrichmentMeta }
  | { ok: false; reason: 'budget_exhausted'; resetAt: UtcMillis }
  | { ok: false; reason: 'model_unavailable'; detail: string }

/** Just under the ~1M-token class of models in `LLM_CHAIN_CHAT`, leaving headroom for the system
 *  prompt and the completion itself. Overridable via `EnrichmentDeps.maxInputTokens` for tests. */
const DEFAULT_MAX_INPUT_TOKENS = 900_000

function buildSystemPrompt(kind: ItemKind): { content: string; version: string } {
  const base = loadPrompt('enrichment.v1.md')
  if (kind !== ItemKindValues.Github) {
    return { content: base.content, version: base.version }
  }
  const repoExtension = loadPrompt('enrichment-repo.v1.md')
  return { content: `${base.content}\n\n${repoExtension.content}`, version: base.version }
}

function buildUserMessage(input: EnrichmentInput, safeContent: string): string {
  const topicsLine =
    input.existingTopics.length > 0
      ? `Existing topics: ${input.existingTopics.map((t) => t.label).join(', ')}`
      : 'Existing topics: (none yet — this is the first item, so proposing a new topic is expected.)'
  return [`Title: ${input.title}`, `Kind: ${input.kind}`, topicsLine, '', wrapUntrustedContent(safeContent)].join(
    '\n',
  )
}

function mergeKindFields(
  extractorFields: Record<string, unknown> | undefined,
  modelFields: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!extractorFields && !modelFields) return undefined
  return { ...(extractorFields ?? {}), ...(modelFields ?? {}) }
}

export async function enrichItem(input: EnrichmentInput, deps: EnrichmentDeps): Promise<EnrichOutcome> {
  const system = buildSystemPrompt(input.kind)
  const { text: safeContent } = truncateToTokenBudget(
    input.contentText,
    deps.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS,
  )

  const messages: LLMMessage[] = [
    { role: 'system', content: system.content },
    { role: 'user', content: buildUserMessage(input, safeContent) },
  ]

  const schema = buildEnrichmentSchema(input.kind)

  let structuredResult
  try {
    // No explicit maxTokens here: `OpenRouterProvider.structured()`'s own default
    // (`DEFAULT_STRUCTURED_MAX_TOKENS`, provider.ts) is already calibrated for this exact task —
    // verified live against a reasoning-capable chain-A model, which needs real headroom even
    // with `reasoning` disabled. Restating the number here would just be a second place for it
    // to drift out of sync.
    structuredResult = await deps.provider.structured(messages, schema)
  } catch (err) {
    if (err instanceof BudgetExhaustedError) {
      return { ok: false, reason: 'budget_exhausted', resetAt: err.resetAt }
    }
    if (err instanceof ChainExhaustedError || err instanceof SchemaValidationError) {
      return { ok: false, reason: 'model_unavailable', detail: err.message }
    }
    throw err
  }

  const mergedResult: EnrichmentResult = {
    ...structuredResult.data,
    kindFields: mergeKindFields(input.extractorKindFields, structuredResult.data.kindFields),
  }

  const topic = await assignTopic(
    mergedResult.topic,
    input.existingTopics,
    deps.embeddingProvider,
    deps.topicDistanceThreshold,
  )
  // An existing-topic match is normalized to that topic's canonical label, so storage doesn't
  // create a near-duplicate string that only differs in wording/case from what already exists. A
  // genuinely new topic keeps the model's own proposed label untouched.
  const finalResult: EnrichmentResult = topic.isNew ? mergedResult : { ...mergedResult, topic: topic.label }

  return {
    ok: true,
    result: finalResult,
    topic,
    meta: {
      modelRequested: structuredResult.modelRequested,
      modelResolved: structuredResult.modelResolved,
      promptVersion: system.version,
      promptTokens: structuredResult.promptTokens,
      completionTokens: structuredResult.completionTokens,
    },
  }
}

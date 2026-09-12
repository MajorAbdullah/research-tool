/**
 * `OpenRouterProvider` — the concrete `LLMProvider` (src/types/contracts.ts) that everything else
 * depends on the *interface* of, never this class directly (Dependency Inversion — CLAUDE.md's
 * Core Design Principles). Ties together the chain runner, schema strategies, capability probe,
 * budget manager, rate limiter, call logger, and the long-content router behind the two frozen
 * methods `complete()`/`structured()`.
 *
 * Two instances exist in the running app, both this same class, configured differently:
 * `createEnrichmentProvider()` (Chain A, `background` lane, long-content fallback into Chain B)
 * and `createChatProvider()` (Chain B, `interactive` lane, no further fallback — it's already the
 * largest-context chain). See ADR 0005.
 */

import type { ZodType } from 'zod'
import type {
  LLMCallOptions,
  LLMCompletion,
  LLMMessage,
  LLMProvider,
  LLMStructuredResult,
} from '@/types/contracts'
import type { CapabilityProbe } from './capability-probe'
import type { BudgetLane, BudgetManager } from './budget'
import type { TokenBucket } from './rate-limiter'
import type { LlmCallLog } from './llm-call-log'
import { runChain } from './chain'
import { callChatCompletion, type FetchLike } from './openrouter-client'
import { callStructured } from './schema-strategies'
import { routeForContentLength } from './long-content-router'
import { ModelRefusalError } from './errors'

/** A hung provider must never hang the caller (frozen `LLMCallOptions` doc) — applied whenever a
 *  caller doesn't supply its own. */
export const DEFAULT_TIMEOUT_MS = 30_000
/** Free-form chat/RAG answers can run long; still capped, never unbounded. */
export const DEFAULT_COMPLETE_MAX_TOKENS = 2048
/**
 * Verified live against `nvidia/nemotron-3-super-120b-a12b:free` (first in `LLM_CHAIN_ENRICH`):
 * with a tight cap like 300 and no `reasoning` override, a reasoning-capable model spends the
 * whole budget on chain-of-thought prose and returns zero parseable JSON (`finish_reason:
 * 'length'`). `reasoning: {enabled:false}` (schema-strategies.ts) fixes the *content*, but the cap
 * still needs headroom for a legitimate `{tldr, bullets, tags, topic, confidence, kindFields}`
 * payload — 3000 is the verified-safe default; per-task overrides still go through
 * `LLMCallOptions.maxTokens`.
 */
export const DEFAULT_STRUCTURED_MAX_TOKENS = 3000

export interface OpenRouterProviderOptions {
  /** Label used in error messages / chain-exhaustion diagnostics only — not sent to the API. */
  chainName: string
  models: readonly string[]
  lane: BudgetLane
  apiKey: string
  capabilityProbe: CapabilityProbe
  budget: BudgetManager
  rateLimiter: TokenBucket
  callLog: LlmCallLog
  promptVersion: string
  fetchImpl?: FetchLike
  /** Chain B's models, wired in only for the enrichment provider — the long-content router
   *  substitutes these when even Chain A's largest-context model can't hold the input. */
  longContentFallbackModels?: readonly string[]
}

export class OpenRouterProvider implements LLMProvider {
  constructor(private readonly opts: OpenRouterProviderOptions) {}

  async complete(messages: LLMMessage[], options?: LLMCallOptions): Promise<LLMCompletion> {
    const maxTokens = options?.maxTokens ?? DEFAULT_COMPLETE_MAX_TOKENS
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const result = await runChain(
      this.opts.chainName,
      this.opts.models,
      this.chainDeps(timeoutMs),
      async (model) => {
        const response = await callChatCompletion(
          {
            model,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            max_tokens: maxTokens,
          },
          { apiKey: this.opts.apiKey, timeoutMs, fetchImpl: this.opts.fetchImpl },
        )
        const choice = response.choices[0]
        if (!choice) throw new Error(`OpenRouter response for '${model}' had no choices`)
        if (choice.message.refusal) throw new ModelRefusalError(model, choice.message.refusal)
        return {
          value: choice.message.content ?? '',
          resolvedModel: response.model,
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
        }
      },
    )

    return {
      text: result.value,
      modelRequested: result.modelRequested,
      modelResolved: result.modelResolved,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    }
  }

  async structured<T>(
    messages: LLMMessage[],
    schema: ZodType<T>,
    options?: LLMCallOptions,
  ): Promise<LLMStructuredResult<T>> {
    const maxTokens = options?.maxTokens ?? DEFAULT_STRUCTURED_MAX_TOKENS
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const route = routeForContentLength(
      messages,
      this.opts.models,
      this.opts.longContentFallbackModels,
      this.opts.capabilityProbe,
      maxTokens,
    )
    const chainName = route.routedToFallback
      ? `${this.opts.chainName}(long-content)`
      : this.opts.chainName

    const result = await runChain(
      chainName,
      route.models,
      this.chainDeps(timeoutMs),
      async (model, capability) => {
        const r = await callStructured({
          model,
          strategy: capability.schemaStrategy,
          messages,
          schema,
          maxTokens,
          timeoutMs,
          apiKey: this.opts.apiKey,
          fetchImpl: this.opts.fetchImpl,
        })
        return {
          value: r.data,
          resolvedModel: r.resolvedModel,
          promptTokens: r.promptTokens,
          completionTokens: r.completionTokens,
        }
      },
    )

    return {
      data: result.value,
      modelRequested: result.modelRequested,
      modelResolved: result.modelResolved,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      schemaStrategy: this.opts.capabilityProbe.getCapability(result.modelRequested).schemaStrategy,
    }
  }

  private chainDeps(timeoutMs: number) {
    return {
      capabilityProbe: this.opts.capabilityProbe,
      budget: this.opts.budget,
      lane: this.opts.lane,
      rateLimiter: this.opts.rateLimiter,
      callLog: this.opts.callLog,
      promptVersion: this.opts.promptVersion,
      apiKey: this.opts.apiKey,
      timeoutMs,
      fetchImpl: this.opts.fetchImpl,
    }
  }
}

export interface CreateProviderDeps {
  apiKey: string
  chainEnrich: readonly string[]
  chainChat: readonly string[]
  capabilityProbe: CapabilityProbe
  budget: BudgetManager
  rateLimiter: TokenBucket
  callLog: LlmCallLog
  promptVersion: string
  fetchImpl?: FetchLike
}

/** Chain A, `background` lane, long-content fallback into Chain B. What the enrichment pipeline
 *  (P7) depends on, typed as `LLMProvider` — never as this concrete class. */
export function createEnrichmentProvider(deps: CreateProviderDeps): LLMProvider {
  return new OpenRouterProvider({
    chainName: 'enrich',
    models: deps.chainEnrich,
    lane: 'background',
    longContentFallbackModels: deps.chainChat,
    apiKey: deps.apiKey,
    capabilityProbe: deps.capabilityProbe,
    budget: deps.budget,
    rateLimiter: deps.rateLimiter,
    callLog: deps.callLog,
    promptVersion: deps.promptVersion,
    fetchImpl: deps.fetchImpl,
  })
}

/** Chain B, `interactive` lane — already the largest-context chain, so no further fallback. What
 *  chat (P13) depends on. */
export function createChatProvider(deps: CreateProviderDeps): LLMProvider {
  return new OpenRouterProvider({
    chainName: 'chat',
    models: deps.chainChat,
    lane: 'interactive',
    apiKey: deps.apiKey,
    capabilityProbe: deps.capabilityProbe,
    budget: deps.budget,
    rateLimiter: deps.rateLimiter,
    callLog: deps.callLog,
    promptVersion: deps.promptVersion,
    fetchImpl: deps.fetchImpl,
  })
}

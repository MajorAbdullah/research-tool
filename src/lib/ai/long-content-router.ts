/**
 * Long-content router (P3.1.1b, ADR 0005): content that overflows the enrichment chain's context
 * window routes to a 1M-context chat-chain model instead of being truncated — a 4-hour transcript
 * or a 300-page PDF keeps its ending. Chain A's own models are still tried first and in order;
 * this only swaps in Chain B's model list when even Chain A's *largest*-context model can't hold
 * the input plus a safety reserve for the completion itself.
 */

import type { LLMMessage } from '@/types/contracts'
import type { CapabilityProbe } from './capability-probe'
import { estimateTokens } from './token-estimate'

export interface RouteDecision {
  models: readonly string[]
  /** True when the primary chain's largest-context model still couldn't hold the input and the
   *  fallback chain was substituted. */
  routedToFallback: boolean
}

export function routeForContentLength(
  messages: LLMMessage[],
  primaryModels: readonly string[],
  fallbackModels: readonly string[] | undefined,
  capabilityProbe: CapabilityProbe,
  completionReserveTokens: number,
): RouteDecision {
  const inputTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  const primaryMax = capabilityProbe.maxContextLength(primaryModels)
  const fits = inputTokens + completionReserveTokens <= primaryMax
  if (fits || !fallbackModels || fallbackModels.length === 0) {
    return { models: primaryModels, routedToFallback: false }
  }
  return { models: fallbackModels, routedToFallback: true }
}

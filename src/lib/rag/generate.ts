/**
 * Generation: the third layer of the hallucination guard (P13.2/P13.5). Calls the frozen
 * `LLMProvider.complete()` (via `createChatProvider()` — the route wires that up, this module
 * only depends on the `LLMProvider` interface, never the concrete class), validates the citation
 * rule, and runs the one corrective retry CLAUDE.md's gen-ai section requires ("feed validation
 * errors back for one corrective retry, then fail loudly") before giving up gracefully onto the
 * same "nothing saved" path P13.5 already defines — never a raw error, and never an uncited claim
 * served to the user.
 *
 * This module is only ever invoked once the pre-generation gate (`groundedness.ts`) and context
 * assembly have already produced at least one source — `sourceCount` here is always > 0.
 */

import type { LLMCallOptions, LLMMessage, LLMProvider } from '@/types/contracts'
import { validateCitations, looksLikeRefusal } from './citations'
import { buildCitationRetryMessages } from './prompt'
import { INSUFFICIENT_CONTEXT_MESSAGE } from './groundedness'

export interface GenerateAnswerResult {
  text: string
  /** `false` suppresses citation chips client-side (docs/API.md §3.8) — either the model itself
   *  said it has nothing, or its citations never became valid even after the retry. */
  grounded: boolean
  citationRetryUsed: boolean
  /** `true` only on the "retried and still invalid" fallback — the signal that a bad answer here
   *  is a generation-side failure, not a retrieval-side one (CLAUDE.md → RAG: "diagnosable as
   *  retrieval-vs-generation without guessing"). */
  citationValidationFailed: boolean
  meta: {
    modelRequested: string
    modelResolved: string
    promptTokens: number
    completionTokens: number
  }
}

function toMeta(completion: {
  modelRequested: string
  modelResolved: string
  promptTokens: number
  completionTokens: number
}): GenerateAnswerResult['meta'] {
  return {
    modelRequested: completion.modelRequested,
    modelResolved: completion.modelResolved,
    promptTokens: completion.promptTokens,
    completionTokens: completion.completionTokens,
  }
}

export async function generateGroundedAnswer(
  provider: LLMProvider,
  messages: LLMMessage[],
  sourceCount: number,
  options?: LLMCallOptions,
): Promise<GenerateAnswerResult> {
  const first = await provider.complete(messages, options)
  const firstValidation = validateCitations(first.text, sourceCount)

  if (firstValidation.valid) {
    return {
      text: first.text,
      grounded: true,
      citationRetryUsed: false,
      citationValidationFailed: false,
      meta: toMeta(first),
    }
  }
  if (looksLikeRefusal(first.text)) {
    // A legitimate "I don't have this" needs no citation and no retry — that's the correct
    // behavior, not a failure to correct.
    return {
      text: first.text,
      grounded: false,
      citationRetryUsed: false,
      citationValidationFailed: false,
      meta: toMeta(first),
    }
  }

  // One corrective retry (genai-best-practices: "feed validation errors back for one corrective
  // retry, then fail loudly").
  const retryMessages = buildCitationRetryMessages(messages, first.text)
  const second = await provider.complete(retryMessages, options)
  const secondValidation = validateCitations(second.text, sourceCount)

  if (secondValidation.valid) {
    return {
      text: second.text,
      grounded: true,
      citationRetryUsed: true,
      citationValidationFailed: false,
      meta: toMeta(second),
    }
  }
  if (looksLikeRefusal(second.text)) {
    return {
      text: second.text,
      grounded: false,
      citationRetryUsed: true,
      citationValidationFailed: false,
      meta: toMeta(second),
    }
  }

  // Still uncited after the retry: "fail loudly" means visible and logged, never a silently
  // served, unsupported claim — falling back to the same fixed message the pre-generation gate
  // uses keeps exactly one "nothing to show for this" surface for the client to render, rather
  // than inventing a second one.
  return {
    text: INSUFFICIENT_CONTEXT_MESSAGE,
    grounded: false,
    citationRetryUsed: true,
    citationValidationFailed: true,
    meta: toMeta(second),
  }
}

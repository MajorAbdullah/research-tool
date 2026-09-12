/**
 * Typed errors for the AI provider layer.
 *
 * `LLMProvider` (src/types/contracts.ts) is frozen: `complete()`/`structured()` must resolve to
 * `LLMCompletion`/`LLMStructuredResult<T>` — there is no room in those return types for a
 * "budget exhausted" or "no model available" variant. So those states surface as *typed*
 * rejections (subclasses of `Error`, distinguishable with `instanceof`) rather than a change to
 * the frozen success shape. Callers that want a non-throwing result (P7's job handlers, P3's own
 * `enrichItem()`) catch these specific classes and translate them into whatever discriminated
 * result shape they need — see `enrichment.ts` for the pattern. "Not a hang" is satisfied by
 * throwing synchronously/promptly instead of retrying-with-backoff inline.
 */

import type { UtcMillis } from '@/types/contracts'

/**
 * The daily (or per-minute-bucket-starved) budget is exhausted for the lane this call was made
 * on. `resetAt` is when the caller can expect capacity again — UTC midnight for the daily cap.
 * Thrown *before* any HTTP call is attempted, never after a partial request.
 */
export class BudgetExhaustedError extends Error {
  readonly resetAt: UtcMillis
  readonly lane: 'interactive' | 'background'

  constructor(resetAt: UtcMillis, lane: 'interactive' | 'background') {
    super(
      `LLM daily budget exhausted for the '${lane}' lane; resets at ${new Date(resetAt).toISOString()}`,
    )
    this.name = 'BudgetExhaustedError'
    this.resetAt = resetAt
    this.lane = lane
  }
}

/** One failed attempt against a single model, recorded on the way through a chain. */
export interface ChainAttemptFailure {
  model: string
  status?: number
  message: string
}

/**
 * Every model in the configured chain either errored (429/404/503/timeout) or was skipped
 * (budget). The chain is the unit of "availability, not capacity" — see ADR 0004/0005 — so
 * exhausting it means every fallback was tried and none worked, not that quota ran out (that's
 * `BudgetExhaustedError`).
 */
export class ChainExhaustedError extends Error {
  readonly attempts: ChainAttemptFailure[]

  constructor(chainName: string, attempts: ChainAttemptFailure[]) {
    super(
      `LLM chain '${chainName}' exhausted after ${attempts.length} model(s): ` +
        attempts.map((a) => `${a.model} (${a.status ?? 'error'}: ${a.message})`).join('; '),
    )
    this.name = 'ChainExhaustedError'
    this.attempts = attempts
  }
}

/**
 * A model returned a response that never became schema-valid, even after the single corrective
 * repair retry (genai-best-practices: "one corrective retry ... then fail loudly"). Carries the
 * last validation message for diagnostics.
 */
export class SchemaValidationError extends Error {
  readonly model: string
  readonly lastValidationMessage: string

  constructor(model: string, lastValidationMessage: string) {
    super(`Model '${model}' did not return schema-valid output: ${lastValidationMessage}`)
    this.name = 'SchemaValidationError'
    this.model = model
    this.lastValidationMessage = lastValidationMessage
  }
}

/** A single call exceeded its `timeoutMs`. Distinguished from other HTTP failures for logging. */
export class LlmTimeoutError extends Error {
  readonly model: string
  readonly timeoutMs: number

  constructor(model: string, timeoutMs: number) {
    super(`Call to model '${model}' timed out after ${timeoutMs}ms`)
    this.name = 'LlmTimeoutError'
    this.model = model
    this.timeoutMs = timeoutMs
  }
}

/**
 * A non-2xx response from OpenRouter's chat-completions endpoint. `status` is what `chain.ts`
 * switches on to decide "try the next model in the chain" (429 rate-limited, 404 model
 * deprecated/unknown, 503 upstream unavailable) versus a hard failure worth surfacing immediately.
 */
export class OpenRouterHttpError extends Error {
  readonly status: number
  readonly model: string

  constructor(status: number, model: string, bodyText: string) {
    super(`OpenRouter returned ${status} for model '${model}': ${bodyText.slice(0, 500)}`)
    this.name = 'OpenRouterHttpError'
    this.status = status
    this.model = model
  }
}

/**
 * The model declined to answer (OpenRouter surfaces this as a non-null `message.refusal`,
 * distinct from `message.content`). Verified live against `nvidia/nemotron-3-super-120b-a12b:free`
 * — this is a model policy decision, not malformed output, so retrying the identical prompt
 * against the *same* model won't fix it. `callStructured()` skips its one-shot repair retry for
 * this case and lets the chain fall over to the next model instead of wasting a second call.
 */
export class ModelRefusalError extends Error {
  readonly model: string
  readonly refusal: string

  constructor(model: string, refusal: string) {
    super(`Model '${model}' refused: ${refusal}`)
    this.name = 'ModelRefusalError'
    this.model = model
    this.refusal = refusal
  }
}

/** The statuses that mean "this model isn't available right now, fail over to the next one in
 *  the chain" — availability, not capacity (ADR 0004: rotation buys availability, never more
 *  daily requests). A 429 here is OpenRouter telling us to slow down or that this model's own
 *  sub-limit is hit, not necessarily that our whole daily budget is gone — that's the separate,
 *  pre-checked `BudgetManager`. */
export const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([429, 404, 503])

/**
 * The shared model-fallover engine behind both `LLMProvider.complete()` and `.structured()`
 * (P3.1.1): tries each model in an ordered chain in turn. A model failure — rate-limited,
 * deprecated, upstream-unavailable, timed out, or (for structured calls) never producing
 * schema-valid output even after its one repair retry — "degrades the item" by falling to the
 * next model, never by throwing out of the whole request (CLAUDE.md/P3.1.10). Only exhausting
 * every model in the chain becomes a hard, typed `ChainExhaustedError`.
 *
 * Budget and pacing are enforced here, per attempt, not once per logical call: each fallover
 * retry is a real second HTTP request against OpenRouter's single global daily/per-minute
 * counter, so the gate has to run again before every one of them, including retries.
 */

import type { CapabilityProbe, ModelCapability } from './capability-probe'
import type { BudgetLane, BudgetManager } from './budget'
import type { TokenBucket } from './rate-limiter'
import type { LlmCallLog } from './llm-call-log'
import type { FetchLike } from './openrouter-client'
import { BudgetExhaustedError, ChainExhaustedError, type ChainAttemptFailure } from './errors'

export interface ChainDeps {
  capabilityProbe: CapabilityProbe
  budget: BudgetManager
  lane: BudgetLane
  rateLimiter: TokenBucket
  callLog: LlmCallLog
  promptVersion: string
  apiKey: string
  timeoutMs: number
  fetchImpl?: FetchLike
}

export interface ChainAttemptOutcome<R> {
  value: R
  resolvedModel: string
  promptTokens: number
  completionTokens: number
}

export interface ChainResult<R> {
  value: R
  modelRequested: string
  modelResolved: string
  promptTokens: number
  completionTokens: number
}

/**
 * Runs `attempt` against each model in `models`, in order, until one succeeds or the chain is
 * exhausted.
 *
 * Every kind of attempt failure is treated as "this model didn't work for this request, try the
 * next one" — including an unexpected/non-HTTP error. This is deliberate, not a swallowed bug:
 * the same request is replayed against every remaining model, so a genuine bug in request
 * construction fails identically on all of them, and `ChainExhaustedError`'s aggregated message
 * (every model's failure reason) still surfaces it — just as a chain exhaustion instead of an
 * immediate crash, which is exactly "a model failure degrades the item; it never crashes the
 * request."
 */
export async function runChain<R>(
  chainName: string,
  models: readonly string[],
  deps: ChainDeps,
  attempt: (model: string, capability: ModelCapability) => Promise<ChainAttemptOutcome<R>>,
): Promise<ChainResult<R>> {
  const failures: ChainAttemptFailure[] = []
  for (const model of models) {
    const reservation = deps.budget.reserve(deps.lane)
    if (!reservation.ok) {
      // Fail fast, not a hang: no HTTP call is made once the lane's share of the daily budget is
      // spent. Thrown (not returned) because this crosses the frozen `LLMProvider` boundary,
      // whose success return types have no room for a non-exception "exhausted" variant — see
      // errors.ts's header comment. Higher-level callers (e.g. `enrichItem()`) catch this
      // specifically and turn it back into a plain, non-throwing result.
      throw new BudgetExhaustedError(reservation.resetAt, deps.lane)
    }
    await deps.rateLimiter.acquire()
    const capability = deps.capabilityProbe.getCapability(model)
    try {
      const outcome = await attempt(model, capability)
      deps.callLog.record({
        modelRequested: model,
        modelResolved: outcome.resolvedModel,
        promptVersion: deps.promptVersion,
        promptTokens: outcome.promptTokens,
        completionTokens: outcome.completionTokens,
      })
      return {
        value: outcome.value,
        modelRequested: model,
        modelResolved: outcome.resolvedModel,
        promptTokens: outcome.promptTokens,
        completionTokens: outcome.completionTokens,
      }
    } catch (err) {
      const status = extractStatus(err)
      failures.push({
        model,
        status,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  throw new ChainExhaustedError(chainName, failures)
}

function extractStatus(err: unknown): number | undefined {
  return err instanceof Error && 'status' in err && typeof err.status === 'number'
    ? err.status
    : undefined
}

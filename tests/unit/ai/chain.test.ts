import { describe, expect, it } from 'vitest'
import { runChain, type ChainDeps } from '@/lib/ai/chain'
import { CapabilityProbe } from '@/lib/ai/capability-probe'
import { BudgetManager } from '@/lib/ai/budget'
import { TokenBucket } from '@/lib/ai/rate-limiter'
import { createInMemoryLlmCallLog } from '@/lib/ai/llm-call-log'
import { createInMemorySettingsPort } from '@/lib/ai/settings-store'
import { BudgetExhaustedError, ChainExhaustedError, OpenRouterHttpError, LlmTimeoutError } from '@/lib/ai/errors'

function makeDeps(overrides: Partial<ChainDeps> = {}): ChainDeps {
  // Resolved field-by-field (not `{...defaults, ...overrides}`) because `Partial<ChainDeps>`
  // types every property as possibly `undefined`, which would infect the return type even for
  // fields the caller genuinely omitted.
  return {
    capabilityProbe: overrides.capabilityProbe ?? new CapabilityProbe(),
    budget: overrides.budget ?? new BudgetManager(createInMemorySettingsPort(), 900, 100),
    lane: overrides.lane ?? 'background',
    // High capacity/refill so pacing never blocks these tests — pacing itself is
    // rate-limiter.test.ts's job, not chain.ts's.
    rateLimiter: overrides.rateLimiter ?? new TokenBucket({ capacity: 1000, refillPerMinute: 6000 }),
    callLog: overrides.callLog ?? createInMemoryLlmCallLog(),
    promptVersion: overrides.promptVersion ?? 'v1',
    apiKey: overrides.apiKey ?? 'test-key',
    timeoutMs: overrides.timeoutMs ?? 5000,
    fetchImpl: overrides.fetchImpl,
  }
}

describe('runChain', () => {
  it('falls over from a 429 on the first model to a working second model', async () => {
    const attempted: string[] = []
    const deps = makeDeps()

    const result = await runChain('enrich', ['model-a', 'model-b'], deps, async (model) => {
      attempted.push(model)
      if (model === 'model-a') {
        throw new OpenRouterHttpError(429, model, 'rate limited')
      }
      return { value: 'ok', resolvedModel: model, promptTokens: 10, completionTokens: 5 }
    })

    expect(attempted).toEqual(['model-a', 'model-b'])
    expect(result.modelRequested).toBe('model-b')
    expect(result.modelResolved).toBe('model-b')
    expect(result.value).toBe('ok')
  })

  it('falls over on a timeout the same way it does on an HTTP error', async () => {
    const deps = makeDeps()
    const result = await runChain('enrich', ['model-a', 'model-b'], deps, async (model) => {
      if (model === 'model-a') throw new LlmTimeoutError(model, 5000)
      return { value: 'ok', resolvedModel: model, promptTokens: 1, completionTokens: 1 }
    })
    expect(result.modelRequested).toBe('model-b')
  })

  it('only logs the model that actually succeeded, not the ones that failed first', async () => {
    const callLog = createInMemoryLlmCallLog()
    const deps = makeDeps({ callLog })

    await runChain('enrich', ['model-a', 'model-b', 'model-c'], deps, async (model) => {
      if (model !== 'model-c') throw new OpenRouterHttpError(503, model, 'unavailable')
      return { value: 'ok', resolvedModel: 'model-c-resolved', promptTokens: 7, completionTokens: 3 }
    })

    expect(callLog.entries).toHaveLength(1)
    expect(callLog.entries[0]).toMatchObject({
      modelRequested: 'model-c',
      modelResolved: 'model-c-resolved',
      promptVersion: 'v1',
      promptTokens: 7,
      completionTokens: 3,
    })
  })

  it('throws a typed ChainExhaustedError carrying every attempt once all models fail', async () => {
    const deps = makeDeps()
    const attempt = runChain('enrich', ['model-a', 'model-b'], deps, async (model) => {
      throw new OpenRouterHttpError(404, model, 'deprecated')
    })

    await expect(attempt).rejects.toThrow(ChainExhaustedError)
    try {
      await attempt
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ChainExhaustedError)
      const chainErr = err as ChainExhaustedError
      expect(chainErr.attempts).toHaveLength(2)
      expect(chainErr.attempts.map((a) => a.model)).toEqual(['model-a', 'model-b'])
      expect(chainErr.attempts[0]?.status).toBe(404)
    }
  })

  it('a non-HTTP, unexpected error from one model still falls through to the next', async () => {
    const deps = makeDeps()
    const result = await runChain('enrich', ['model-a', 'model-b'], deps, async (model) => {
      if (model === 'model-a') throw new TypeError('bug in request construction')
      return { value: 'ok', resolvedModel: model, promptTokens: 1, completionTokens: 1 }
    })
    expect(result.modelRequested).toBe('model-b')
  })

  it('throws BudgetExhaustedError immediately and never calls attempt() at all', async () => {
    const budget = new BudgetManager(createInMemorySettingsPort(), 1, 0) // cap of 1, none reserved for interactive
    budget.reserve('background') // spend the only request

    let called = false
    const deps = makeDeps({ budget })
    const attempt = runChain('enrich', ['model-a'], deps, async (model) => {
      called = true
      return { value: 'unreachable', resolvedModel: model, promptTokens: 0, completionTokens: 0 }
    })

    await expect(attempt).rejects.toThrow(BudgetExhaustedError)
    expect(called).toBe(false)
  })

  it('stops falling over mid-chain once the budget runs out between attempts', async () => {
    // Cap of 1 total request. model-a's attempt spends it (via a retryable failure); by the time
    // we'd try model-b, the reserve() check for that second attempt must fail.
    const budget = new BudgetManager(createInMemorySettingsPort(), 1, 0)
    const deps = makeDeps({ budget })
    let attempts = 0

    const attempt = runChain('enrich', ['model-a', 'model-b'], deps, async (model) => {
      attempts += 1
      throw new OpenRouterHttpError(503, model, 'unavailable')
    })

    await expect(attempt).rejects.toThrow(BudgetExhaustedError)
    expect(attempts).toBe(1) // model-a was tried (and spent the budget); model-b never was
  })
})

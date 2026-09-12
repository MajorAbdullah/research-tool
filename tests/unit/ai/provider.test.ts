import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  OpenRouterProvider,
  DEFAULT_COMPLETE_MAX_TOKENS,
  DEFAULT_STRUCTURED_MAX_TOKENS,
  type OpenRouterProviderOptions,
} from '@/lib/ai/provider'
import { CapabilityProbe, type ModelCapability } from '@/lib/ai/capability-probe'
import { BudgetManager } from '@/lib/ai/budget'
import { TokenBucket } from '@/lib/ai/rate-limiter'
import { createInMemoryLlmCallLog } from '@/lib/ai/llm-call-log'
import { createInMemorySettingsPort } from '@/lib/ai/settings-store'
import type { FetchLike, OpenRouterChatRequest, OpenRouterChatResponse } from '@/lib/ai/openrouter-client'

function capability(id: string, contextLength: number, schemaStrategy: ModelCapability['schemaStrategy']): ModelCapability {
  return { id, contextLength, supportedParameters: [], schemaStrategy }
}

function chatResponse(content: string, model: string): OpenRouterChatResponse {
  return {
    id: 'gen',
    model,
    choices: [{ index: 0, message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
  }
}

function makeProvider(overrides: Partial<OpenRouterProviderOptions> = {}, fetchImpl?: FetchLike) {
  const probe = new CapabilityProbe(
    new Map([
      ['chain-a-model', capability('chain-a-model', 262_144, 'response_format')],
      ['chain-b-model', capability('chain-b-model', 1_000_000, 'response_format')],
    ]),
  )
  return new OpenRouterProvider({
    chainName: 'enrich',
    models: ['chain-a-model'],
    lane: 'background',
    apiKey: 'test-key',
    capabilityProbe: probe,
    budget: new BudgetManager(createInMemorySettingsPort(), 900, 100),
    rateLimiter: new TokenBucket({ capacity: 1000, refillPerMinute: 6000 }),
    callLog: createInMemoryLlmCallLog(),
    promptVersion: 'v1',
    fetchImpl,
    ...overrides,
  })
}

describe('OpenRouterProvider.complete', () => {
  it('returns text and model metadata, with a default max_tokens applied', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => chatResponse('hello there', 'chain-a-model'),
    } as unknown as Response)
    const provider = makeProvider({}, fetchImpl)

    const result = await provider.complete([{ role: 'user', content: 'hi' }])

    expect(result.text).toBe('hello there')
    expect(result.modelRequested).toBe('chain-a-model')
    expect(result.modelResolved).toBe('chain-a-model')
    expect(result.promptTokens).toBe(30)
    expect(result.completionTokens).toBe(15)

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as OpenRouterChatRequest
    expect(body.max_tokens).toBe(DEFAULT_COMPLETE_MAX_TOKENS)
    expect(body.reasoning).toBeUndefined() // free-form chat/RAG path: reasoning is left alone
  })
})

describe('OpenRouterProvider.structured', () => {
  it('returns validated data, resolved model, and the schema strategy that was used', async () => {
    const schema = z.object({ ok: z.boolean() })
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => chatResponse(JSON.stringify({ ok: true }), 'chain-a-model'),
    } as unknown as Response)
    const provider = makeProvider({}, fetchImpl)

    const result = await provider.structured([{ role: 'user', content: 'hi' }], schema)

    expect(result.data).toEqual({ ok: true })
    expect(result.schemaStrategy).toBe('response_format')
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as OpenRouterChatRequest
    expect(body.max_tokens).toBe(DEFAULT_STRUCTURED_MAX_TOKENS)
    expect(body.reasoning).toEqual({ enabled: false })
  })

  it('routes to the long-content fallback chain when input overflows the primary chain', async () => {
    const schema = z.object({ ok: z.boolean() })
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => chatResponse(JSON.stringify({ ok: true }), 'chain-b-model'),
    } as unknown as Response)
    const provider = makeProvider({ longContentFallbackModels: ['chain-b-model'] }, fetchImpl)

    // chain-a-model's context is 262,144 tokens; send well over that.
    const hugeContent = 'x'.repeat(262_144 * 4 * 2)
    const result = await provider.structured([{ role: 'user', content: hugeContent }], schema)

    expect(result.modelRequested).toBe('chain-b-model')
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as OpenRouterChatRequest
    expect(body.model).toBe('chain-b-model')
  })

  it('logs the call and increments the shared budget counter', async () => {
    const schema = z.object({ ok: z.boolean() })
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => chatResponse(JSON.stringify({ ok: true }), 'chain-a-model'),
    } as unknown as Response)
    const callLog = createInMemoryLlmCallLog()
    const budget = new BudgetManager(createInMemorySettingsPort(), 900, 100)
    const provider = makeProvider({ callLog, budget }, fetchImpl)

    await provider.structured([{ role: 'user', content: 'hi' }], schema)

    expect(callLog.entries).toHaveLength(1)
    expect(budget.status().usedToday).toBe(1)
  })
})

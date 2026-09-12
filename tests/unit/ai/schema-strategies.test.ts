import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { callStructured, FORCED_TOOL_NAME } from '@/lib/ai/schema-strategies'
import { ModelRefusalError, SchemaValidationError } from '@/lib/ai/errors'
import type { OpenRouterChatRequest, OpenRouterChatResponse } from '@/lib/ai/openrouter-client'

const testSchema = z.object({
  name: z.string(),
  count: z.number().int().min(1),
})

function jsonResponse(content: string, model = 'test/model:free'): OpenRouterChatResponse {
  return {
    id: 'gen-1',
    model,
    choices: [{ index: 0, message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 42, completion_tokens: 17, total_tokens: 59 },
  }
}

function toolCallResponse(argumentsJson: string, model = 'test/model:free'): OpenRouterChatResponse {
  return {
    id: 'gen-2',
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call-1', type: 'function', function: { name: FORCED_TOOL_NAME, arguments: argumentsJson } },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
  }
}

function refusalResponse(refusal: string): OpenRouterChatResponse {
  return {
    id: 'gen-3',
    model: 'test/model:free',
    choices: [{ index: 0, message: { role: 'assistant', content: null, refusal } }],
    usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
  }
}

// No explicit return-type annotation: `ReturnType<typeof vi.fn>` (an unbound generic) widens to
// `Mock<Procedure | Constructable>`, which fails assignability against `FetchLike` even though the
// concrete mock this returns is perfectly callable that way. Let inference produce the specific
// `Mock<Procedure>` type instead.
function fetchReturning(...responses: OpenRouterChatResponse[]) {
  const fetchImpl = vi.fn()
  for (const response of responses) {
    fetchImpl.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => response,
    } as unknown as Response)
  }
  return fetchImpl
}

const baseParams = {
  model: 'test/model:free',
  messages: [
    { role: 'system' as const, content: 'system instructions' },
    { role: 'user' as const, content: 'user content' },
  ],
  schema: testSchema,
  maxTokens: 3000,
  timeoutMs: 5000,
  apiKey: 'test-key',
}

describe('callStructured — response_format strategy', () => {
  it('parses valid JSON content on the first try, one HTTP call', async () => {
    const fetchImpl = fetchReturning(jsonResponse(JSON.stringify({ name: 'sieve', count: 3 })))
    const result = await callStructured({ ...baseParams, strategy: 'response_format', fetchImpl })

    expect(result.data).toEqual({ name: 'sieve', count: 3 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('sends reasoning disabled and the JSON schema in response_format', async () => {
    const fetchImpl = fetchReturning(jsonResponse(JSON.stringify({ name: 'sieve', count: 3 })))
    await callStructured({ ...baseParams, strategy: 'response_format', fetchImpl })

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as OpenRouterChatRequest
    expect(body.reasoning).toEqual({ enabled: false })
    expect(body.response_format?.type).toBe('json_schema')
    expect(body.response_format?.json_schema.schema).toMatchObject({ type: 'object' })
  })

  it('strips a markdown code fence before parsing', async () => {
    const fenced = '```json\n' + JSON.stringify({ name: 'fenced', count: 1 }) + '\n```'
    const fetchImpl = fetchReturning(jsonResponse(fenced))
    const result = await callStructured({ ...baseParams, strategy: 'response_format', fetchImpl })
    expect(result.data).toEqual({ name: 'fenced', count: 1 })
  })
})

describe('callStructured — tool_call strategy', () => {
  it('forces the single save_enrichment tool and reads its arguments', async () => {
    const fetchImpl = fetchReturning(toolCallResponse(JSON.stringify({ name: 'ultra', count: 5 })))
    const result = await callStructured({ ...baseParams, strategy: 'tool_call', fetchImpl })

    expect(result.data).toEqual({ name: 'ultra', count: 5 })
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as OpenRouterChatRequest
    expect(body.tools).toHaveLength(1)
    expect(body.tools?.[0]?.function.name).toBe(FORCED_TOOL_NAME)
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: FORCED_TOOL_NAME } })
    expect(body.reasoning).toEqual({ enabled: false })
  })

  it('throws when no tool call is present at all', async () => {
    const fetchImpl = fetchReturning(jsonResponse('')) // no tool_calls, empty content
    await expect(
      callStructured({ ...baseParams, strategy: 'tool_call', fetchImpl }),
    ).rejects.toThrow()
  })
})

describe('callStructured — prompt_repair strategy', () => {
  it('parses valid JSON returned without any native enforcement', async () => {
    const fetchImpl = fetchReturning(jsonResponse(JSON.stringify({ name: 'repair', count: 2 })))
    const result = await callStructured({ ...baseParams, strategy: 'prompt_repair', fetchImpl })
    expect(result.data).toEqual({ name: 'repair', count: 2 })
  })
})

describe('callStructured — the one corrective repair retry', () => {
  it('retries once with the validation error fed back, then succeeds', async () => {
    const fetchImpl = fetchReturning(
      jsonResponse(JSON.stringify({ name: 'bad', count: 0 })), // count must be >= 1
      jsonResponse(JSON.stringify({ name: 'fixed', count: 1 })),
    )
    const result = await callStructured({ ...baseParams, strategy: 'response_format', fetchImpl })

    expect(result.data).toEqual({ name: 'fixed', count: 1 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    const [, secondInit] = fetchImpl.mock.calls[1] as [string, RequestInit]
    const secondBody = JSON.parse(secondInit.body as string) as OpenRouterChatRequest
    const lastMessage = secondBody.messages.at(-1)
    expect(lastMessage?.role).toBe('user')
    expect(lastMessage?.content).toMatch(/not valid/i)
  })

  it('fails loudly with SchemaValidationError when the repair retry is still invalid', async () => {
    const fetchImpl = fetchReturning(
      jsonResponse(JSON.stringify({ name: 'bad', count: 0 })),
      jsonResponse(JSON.stringify({ name: 'still-bad', count: -1 })),
    )
    await expect(
      callStructured({ ...baseParams, strategy: 'response_format', fetchImpl }),
    ).rejects.toThrow(SchemaValidationError)
    expect(fetchImpl).toHaveBeenCalledTimes(2) // never a third attempt
  })

  it('silently drops an unknown field (e.g. an injected "status") rather than failing', async () => {
    const fetchImpl = fetchReturning(
      jsonResponse(JSON.stringify({ name: 'ok', count: 1, status: 'tested' })),
    )
    const result = await callStructured({ ...baseParams, strategy: 'response_format', fetchImpl })
    expect(result.data).toEqual({ name: 'ok', count: 1 })
    expect(result.data).not.toHaveProperty('status')
    expect(fetchImpl).toHaveBeenCalledTimes(1) // stripping isn't a validation failure
  })
})

describe('callStructured — model refusal', () => {
  it('throws ModelRefusalError immediately, without spending the repair retry', async () => {
    const fetchImpl = fetchReturning(refusalResponse('I will not do that.'))
    await expect(
      callStructured({ ...baseParams, strategy: 'response_format', fetchImpl }),
    ).rejects.toThrow(ModelRefusalError)
    expect(fetchImpl).toHaveBeenCalledTimes(1) // no wasted retry against a refusal
  })
})

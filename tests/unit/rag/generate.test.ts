import { describe, expect, it, vi } from 'vitest'
import type { LLMCallOptions, LLMCompletion, LLMMessage, LLMProvider } from '@/types/contracts'
import { generateGroundedAnswer } from '@/lib/rag/generate'
import { INSUFFICIENT_CONTEXT_MESSAGE } from '@/lib/rag/groundedness'

function completion(text: string, model = 'chat-model'): LLMCompletion {
  return {
    text,
    modelRequested: model,
    modelResolved: model,
    promptTokens: 100,
    completionTokens: 20,
  }
}

function fakeProvider(
  impl: (messages: LLMMessage[], options?: LLMCallOptions) => Promise<LLMCompletion>,
): LLMProvider {
  return {
    complete: vi.fn(impl),
    structured: vi.fn(),
  } as unknown as LLMProvider
}

const BASE_MESSAGES: LLMMessage[] = [
  { role: 'system', content: 'system prompt' },
  { role: 'user', content: 'Source [1]: "vllm"\nQuestion: what did I save about attention?' },
]

describe('generateGroundedAnswer — happy path', () => {
  it('accepts a first attempt with a valid, in-range citation — no retry', async () => {
    const complete = vi.fn(async () => completion('vLLM uses PagedAttention [1].'))
    const provider = fakeProvider(complete)

    const result = await generateGroundedAnswer(provider, BASE_MESSAGES, 1)

    expect(complete).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      text: 'vLLM uses PagedAttention [1].',
      grounded: true,
      citationRetryUsed: false,
      citationValidationFailed: false,
    })
  })

  it('accepts a legitimate refusal with no citations and does not retry', async () => {
    const complete = vi.fn(async () => completion("I don't have anything saved about that."))
    const provider = fakeProvider(complete)

    const result = await generateGroundedAnswer(provider, BASE_MESSAGES, 1)

    expect(complete).toHaveBeenCalledTimes(1)
    expect(result.grounded).toBe(false)
    expect(result.citationRetryUsed).toBe(false)
    expect(result.text).toBe("I don't have anything saved about that.")
  })
})

describe('generateGroundedAnswer — corrective retry (P13.2)', () => {
  it('retries once on an uncited claim, and accepts a valid second attempt', async () => {
    const complete = vi
      .fn<() => Promise<LLMCompletion>>()
      .mockResolvedValueOnce(completion('vLLM uses PagedAttention.')) // no citation
      .mockResolvedValueOnce(completion('vLLM uses PagedAttention [1].'))
    const provider = fakeProvider(complete)

    const result = await generateGroundedAnswer(provider, BASE_MESSAGES, 1)

    expect(complete).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      text: 'vLLM uses PagedAttention [1].',
      grounded: true,
      citationRetryUsed: true,
      citationValidationFailed: false,
    })
  })

  it('retries once on an out-of-range citation index (a hallucinated reference)', async () => {
    const complete = vi
      .fn<() => Promise<LLMCompletion>>()
      .mockResolvedValueOnce(completion('See [9] for details.')) // only 1 source exists
      .mockResolvedValueOnce(completion('vLLM uses PagedAttention [1].'))
    const provider = fakeProvider(complete)

    const result = await generateGroundedAnswer(provider, BASE_MESSAGES, 1)

    expect(complete).toHaveBeenCalledTimes(2)
    expect(result.grounded).toBe(true)
  })

  it('passes the original answer and a corrective instruction into the retry call', async () => {
    let secondCallMessages: LLMMessage[] = []
    const complete = vi
      .fn<(messages: LLMMessage[]) => Promise<LLMCompletion>>()
      .mockImplementationOnce(async () => completion('An uncited claim.'))
      .mockImplementationOnce(async (messages) => {
        secondCallMessages = messages
        return completion('A cited claim [1].')
      })
    const provider = fakeProvider(complete)

    await generateGroundedAnswer(provider, BASE_MESSAGES, 1)

    // The retry replays the original conversation, then the model's own first (uncited) answer,
    // then a corrective user turn — never a silently-mutated original prompt.
    expect(secondCallMessages.slice(0, BASE_MESSAGES.length)).toEqual(BASE_MESSAGES)
    expect(
      secondCallMessages.some((m) => m.role === 'assistant' && m.content === 'An uncited claim.'),
    ).toBe(true)
    const lastMessage = secondCallMessages[secondCallMessages.length - 1]
    expect(lastMessage?.role).toBe('user')
    expect(lastMessage?.content.length).toBeGreaterThan(0)
  })

  it('accepts a refusal on the retry attempt (the model reconsidered and said so)', async () => {
    const complete = vi
      .fn<() => Promise<LLMCompletion>>()
      .mockResolvedValueOnce(completion('An unsupported claim with no citation.'))
      .mockResolvedValueOnce(completion("On reflection, I don't have anything saved about this."))
    const provider = fakeProvider(complete)

    const result = await generateGroundedAnswer(provider, BASE_MESSAGES, 1)

    expect(result.grounded).toBe(false)
    expect(result.citationRetryUsed).toBe(true)
    expect(result.citationValidationFailed).toBe(false)
  })

  it('fails loudly but gracefully when the retry is STILL uncited: falls back to the fixed message', async () => {
    const complete = vi
      .fn<() => Promise<LLMCompletion>>()
      .mockResolvedValueOnce(completion('An uncited claim, attempt one.'))
      .mockResolvedValueOnce(completion('Still an uncited claim, attempt two.'))
    const provider = fakeProvider(complete)

    const result = await generateGroundedAnswer(provider, BASE_MESSAGES, 1)

    expect(complete).toHaveBeenCalledTimes(2)
    expect(result).toEqual(
      expect.objectContaining({
        text: INSUFFICIENT_CONTEXT_MESSAGE,
        grounded: false,
        citationRetryUsed: true,
        citationValidationFailed: true,
      }),
    )
  })
})

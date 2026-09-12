import { describe, expect, it, vi } from 'vitest'
import type { ZodType } from 'zod'
import type {
  EmbeddingProvider,
  EnrichmentResult,
  LLMCallOptions,
  LLMCompletion,
  LLMMessage,
  LLMProvider,
  LLMStructuredResult,
} from '@/types/contracts'
import { ItemKind } from '@/types/contracts'
import { enrichItem, type EnrichmentInput } from '@/lib/ai/enrichment'
import { BudgetExhaustedError, ChainExhaustedError, SchemaValidationError } from '@/lib/ai/errors'

type StructuredImpl = (
  messages: LLMMessage[],
  schema: ZodType<unknown>,
  options?: LLMCallOptions,
) => Promise<LLMStructuredResult<unknown>>

function fakeProvider(structuredImpl: StructuredImpl): LLMProvider {
  return {
    complete: vi.fn<() => Promise<LLMCompletion>>(),
    structured: vi.fn(structuredImpl) as unknown as LLMProvider['structured'],
  }
}

function fakeEmbeddingProvider(vectorsByText: Record<string, number[]> = {}): EmbeddingProvider {
  return {
    model: 'fake-embedder',
    dimensions: 2,
    embed: vi.fn(async (texts: string[]) => texts.map((t) => vectorsByText[t] ?? [0, 0])),
    embedQuery: vi.fn(async (text: string) => vectorsByText[text] ?? [0, 0]),
  }
}

function baseInput(overrides: Partial<EnrichmentInput> = {}): EnrichmentInput {
  return {
    title: 'A Great Article',
    kind: ItemKind.Article,
    contentText: 'This article explains something useful about distributed systems.',
    existingTopics: [],
    ...overrides,
  }
}

function structuredResult(data: unknown, model = 'chain-model'): LLMStructuredResult<unknown> {
  return {
    data,
    modelRequested: model,
    modelResolved: model,
    promptTokens: 200,
    completionTokens: 90,
    schemaStrategy: 'response_format',
  }
}

const validArticleData: EnrichmentResult = {
  tldr: 'A useful explanation of distributed systems.',
  bullets: ['Point one', 'Point two', 'Point three'],
  tags: ['distributed-systems', 'engineering', 'architecture'],
  topic: 'Distributed Systems',
  confidence: 0.9,
}

describe('enrichItem — happy path', () => {
  it('makes exactly one structured() call per item and returns the enriched result', async () => {
    const structured = vi.fn(async () => structuredResult(validArticleData))
    const provider = fakeProvider(structured)

    const outcome = await enrichItem(baseInput(), {
      provider,
      embeddingProvider: fakeEmbeddingProvider(),
    })

    expect(structured).toHaveBeenCalledTimes(1)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.tldr).toBe(validArticleData.tldr)
      expect(outcome.result.tags).toEqual(validArticleData.tags)
      expect(outcome.topic.isNew).toBe(true) // no existing topics to match against
      // Tracks the version parsed from the loaded prompt filename (enrichment.v2.md -> 'v2').
      // Bump this deliberately alongside a prompt version bump — see prompts/CHANGELOG.md.
      expect(outcome.meta.promptVersion).toBe('v2')
      expect(outcome.meta.modelResolved).toBe('chain-model')
    }
  })

  it('builds a system message that never inlines untrusted content outside the delimited block', async () => {
    let capturedMessages: LLMMessage[] = []
    const structured = vi.fn(async (messages: LLMMessage[]) => {
      capturedMessages = messages
      return structuredResult(validArticleData)
    })
    const provider = fakeProvider(structured)

    await enrichItem(baseInput({ contentText: 'plain body text' }), {
      provider,
      embeddingProvider: fakeEmbeddingProvider(),
    })

    const system = capturedMessages.find((m) => m.role === 'system')
    const user = capturedMessages.find((m) => m.role === 'user')
    expect(system?.content).toContain('untrusted_content')
    expect(system?.content).not.toContain('plain body text')
    expect(user?.content).toContain('<untrusted_content>')
    expect(user?.content).toContain('plain body text')
  })

  it('only includes the repo prompt extension for github items', async () => {
    const capturedSystems: string[] = []
    const structured = vi.fn(async (messages: LLMMessage[]) => {
      const system = messages.find((m) => m.role === 'system')
      capturedSystems.push(system?.content ?? '')
      return structuredResult({
        ...validArticleData,
        kindFields: { what_it_does: 'x', primary_use_case: 'y' },
      })
    })
    const provider = fakeProvider(structured)

    await enrichItem(baseInput({ kind: ItemKind.Github }), {
      provider,
      embeddingProvider: fakeEmbeddingProvider(),
    })
    await enrichItem(baseInput({ kind: ItemKind.Article }), {
      provider,
      embeddingProvider: fakeEmbeddingProvider(),
    })

    expect(capturedSystems[0]).toContain('what_it_does')
    expect(capturedSystems[1]).not.toContain('what_it_does')
  })

  it('merges extractor-derived kindFields with the model’s own, model fields winning on overlap', async () => {
    const structured = vi.fn(async () =>
      structuredResult({
        ...validArticleData,
        kindFields: { what_it_does: 'from the model', stars: 999 },
      }),
    )
    const provider = fakeProvider(structured)

    const outcome = await enrichItem(
      baseInput({
        kind: ItemKind.Github,
        extractorKindFields: { language: 'TypeScript', stars: 1 },
      }),
      { provider, embeddingProvider: fakeEmbeddingProvider() },
    )

    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.kindFields).toEqual({
        language: 'TypeScript',
        what_it_does: 'from the model',
        stars: 999, // model's value wins over the extractor's
      })
    }
  })

  it('assigns to an existing topic instead of creating a near-duplicate', async () => {
    const structured = vi.fn(async () =>
      structuredResult({ ...validArticleData, topic: 'LLM Agents' }),
    )
    const provider = fakeProvider(structured)
    const embeddingProvider = fakeEmbeddingProvider({
      'LLM Agents': [0.99, Math.sqrt(1 - 0.99 ** 2)],
      'Agent Frameworks': [1, 0],
    })

    const outcome = await enrichItem(
      baseInput({ existingTopics: [{ id: 42, label: 'Agent Frameworks' }] }),
      { provider, embeddingProvider },
    )

    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.result.topic).toBe('Agent Frameworks')
      expect(outcome.topic).toMatchObject({ isNew: false, topicId: 42 })
    }
  })

  it('truncates content that overflows the configured input budget before it reaches the model', async () => {
    let capturedUser = ''
    const structured = vi.fn(async (messages: LLMMessage[]) => {
      capturedUser = messages.find((m) => m.role === 'user')?.content ?? ''
      return structuredResult(validArticleData)
    })
    const provider = fakeProvider(structured)

    const longContent = 'A'.repeat(5000) + ' CONCLUSION-MARKER'
    await enrichItem(baseInput({ contentText: longContent }), {
      provider,
      embeddingProvider: fakeEmbeddingProvider(),
      maxInputTokens: 100, // 400 chars — forces truncation of a 5000+ char body
    })

    expect(capturedUser).toContain('CONCLUSION-MARKER') // tail survives
    expect(capturedUser.length).toBeLessThan(longContent.length)
  })
})

describe('enrichItem — graceful degradation, never a crash', () => {
  it('turns a BudgetExhaustedError into a typed, non-throwing result', async () => {
    const resetAt = Date.UTC(2026, 8, 13, 0, 0, 0, 0)
    const provider = fakeProvider(async () => {
      throw new BudgetExhaustedError(resetAt, 'background')
    })

    const outcome = await enrichItem(baseInput(), {
      provider,
      embeddingProvider: fakeEmbeddingProvider(),
    })
    expect(outcome).toEqual({ ok: false, reason: 'budget_exhausted', resetAt })
  })

  it('turns a ChainExhaustedError into a typed, non-throwing "model unavailable" result', async () => {
    const provider = fakeProvider(async () => {
      throw new ChainExhaustedError('enrich', [{ model: 'm1', status: 503, message: 'down' }])
    })

    const outcome = await enrichItem(baseInput(), {
      provider,
      embeddingProvider: fakeEmbeddingProvider(),
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.reason).toBe('model_unavailable')
    }
  })

  it('turns a SchemaValidationError into the same graceful "model unavailable" result', async () => {
    const provider = fakeProvider(async () => {
      throw new SchemaValidationError('m1', 'tags: too many')
    })

    const outcome = await enrichItem(baseInput(), {
      provider,
      embeddingProvider: fakeEmbeddingProvider(),
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('model_unavailable')
  })

  it('still propagates a genuinely unexpected error rather than masking it as "model unavailable"', async () => {
    const provider = fakeProvider(async () => {
      throw new TypeError('a real bug')
    })

    await expect(
      enrichItem(baseInput(), { provider, embeddingProvider: fakeEmbeddingProvider() }),
    ).rejects.toThrow(TypeError)
  })
})

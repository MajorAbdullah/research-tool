import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import type { ZodType } from 'zod'
import type {
  LLMCallOptions,
  LLMCompletion,
  LLMMessage,
  LLMProvider,
  LLMStructuredResult,
} from '@/types/contracts'
import { BudgetExhaustedError } from '@/lib/ai'
import { runRelationSweep } from '@/lib/relations/sweep'
import { makeTestDb, type TestDb } from '../../helpers/db'
import { makeUser, makeItem, makeChunk } from '../../helpers/factories'

type StructuredImpl = (
  messages: LLMMessage[],
  schema: ZodType<unknown>,
  options?: LLMCallOptions,
) => Promise<LLMStructuredResult<unknown>>

function fakeProvider(structuredImpl: StructuredImpl): {
  provider: LLMProvider
  structured: ReturnType<typeof vi.fn>
} {
  const structured = vi.fn(structuredImpl)
  return {
    provider: {
      complete: vi.fn<() => Promise<LLMCompletion>>(),
      structured: structured as unknown as LLMProvider['structured'],
    },
    structured,
  }
}

function structuredResult(data: unknown): LLMStructuredResult<unknown> {
  return {
    data,
    modelRequested: 'm',
    modelResolved: 'm',
    promptTokens: 1,
    completionTokens: 1,
    schemaStrategy: 'response_format',
  }
}

describe('runRelationSweep', () => {
  let db: TestDb
  beforeEach(() => {
    db = makeTestDb()
    makeUser(db, 1)
  })
  afterEach(() => db.close())

  it('returns no_pending_pairs and never calls the LLM when nothing is pending', async () => {
    const { provider, structured } = fakeProvider(async () => structuredResult({ labels: [] }))
    const outcome = await runRelationSweep(db, provider, { userId: 1 })
    expect(outcome).toEqual({ ok: false, reason: 'no_pending_pairs' })
    expect(structured).not.toHaveBeenCalled()
  })

  it('end-to-end: collects pairs, makes exactly one LLM call, and persists the labels', async () => {
    const a = makeItem(db, { id: 1, title: 'vllm', tldr: 'inference engine' })
    makeChunk(db, a, 'x', { seed: 1 })
    const b = makeItem(db, { id: 2, title: 'tgi', tldr: 'another inference engine' })
    makeChunk(db, b, 'y', { seed: 1 })

    const { provider, structured } = fakeProvider(async () =>
      structuredResult({
        labels: [{ pairIndex: 0, type: 'alternative', rationale: 'both serve LLMs' }],
      }),
    )

    const outcome = await runRelationSweep(db, provider, { userId: 1 })
    expect(structured).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({
      ok: true,
      pairsConsidered: 1,
      inserted: 1,
      skipped: 0,
      llmRequests: 1,
    })

    const row = db.prepare('select * from relations where item_a=1 and item_b=2').get() as {
      type: string
    }
    expect(row.type).toBe('alternative')
  })

  it('propagates a budget-exhausted outcome without storing anything', async () => {
    const a = makeItem(db, { id: 1 })
    makeChunk(db, a, 'x', { seed: 1 })
    const b = makeItem(db, { id: 2 })
    makeChunk(db, b, 'y', { seed: 1 })

    const resetAt = Date.now() + 60_000
    const { provider } = fakeProvider(async () => {
      throw new BudgetExhaustedError(resetAt, 'background')
    })

    const outcome = await runRelationSweep(db, provider, { userId: 1 })
    expect(outcome).toEqual({ ok: false, reason: 'budget_exhausted', resetAt })
    expect(db.prepare('select count(*) c from relations').get()).toEqual({ c: 0 })
  })

  it('caps a large candidate pool at maxPairs while still making exactly one LLM call', async () => {
    for (let id = 1; id <= 10; id++) {
      const item = makeItem(db, { id })
      makeChunk(db, item, `x${id}`, { seed: 1 })
    }
    const { provider, structured } = fakeProvider(async () => structuredResult({ labels: [] }))
    const outcome = await runRelationSweep(db, provider, {
      userId: 1,
      maxPairs: 3,
      neighborsPerItem: 9,
    })
    expect(structured).toHaveBeenCalledTimes(1)
    if (outcome.ok) expect(outcome.pairsConsidered).toBeLessThanOrEqual(3)
  })
})

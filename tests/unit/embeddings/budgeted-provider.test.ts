import { describe, expect, it, vi } from 'vitest'
import { BudgetedEmbeddingProvider } from '@/lib/embeddings/budgeted-provider'
import { BudgetManager } from '@/lib/ai/budget'
import { BudgetExhaustedError } from '@/lib/ai/errors'
import type { EmbeddingProvider } from '@/types/contracts'
import type { SettingsPort } from '@/lib/ai/settings-store'

/** In-memory SettingsPort — BudgetManager only ever does get/set on two string keys. */
function memorySettings(): SettingsPort {
  const map = new Map<string, string>()
  return {
    get: (k) => map.get(k),
    set: (k, v) => void map.set(k, v),
  }
}

function fakeInner(dimensions = 4): EmbeddingProvider & { calls: number } {
  return {
    model: 'nvidia/nemotron-3-embed-1b:free',
    dimensions,
    calls: 0,
    async embed(texts: string[]) {
      this.calls++
      return texts.map(() => Array.from({ length: dimensions }, () => 0.1))
    },
    async embedQuery() {
      this.calls++
      return Array.from({ length: dimensions }, () => 0.1)
    },
  }
}

describe('BudgetedEmbeddingProvider', () => {
  it('spends ONE request per batch, not one per text', async () => {
    // The whole free-tier design rests on this: the inner provider sends the entire array as a
    // single HTTP request, so charging per text would exhaust a 1000/day budget ~64x early.
    const settings = memorySettings()
    const budget = new BudgetManager(settings, 1000, 100)
    const provider = new BudgetedEmbeddingProvider(fakeInner(), budget, 'background')

    await provider.embed(['a', 'b', 'c', 'd', 'e'])

    expect(budget.status().usedToday).toBe(1)
  })

  it('an empty batch makes no request and therefore costs nothing', async () => {
    const budget = new BudgetManager(memorySettings(), 1000, 100)
    const inner = fakeInner()
    const provider = new BudgetedEmbeddingProvider(inner, budget, 'background')

    expect(await provider.embed([])).toEqual([])
    expect(inner.calls).toBe(0)
    expect(budget.status().usedToday).toBe(0)
  })

  it('throws BudgetExhaustedError WITHOUT calling the provider once the lane is spent', async () => {
    // Thrown before the network call, never after — a request that was refused must not also be
    // billed, and must not hit OpenRouter only to be discarded.
    const budget = new BudgetManager(memorySettings(), 3, 1)
    const inner = fakeInner()
    const provider = new BudgetedEmbeddingProvider(inner, budget, 'background')

    // background lane ceiling is dailyCap - interactiveReserve = 2
    await provider.embedQuery('one')
    await provider.embedQuery('two')
    expect(inner.calls).toBe(2)

    await expect(provider.embedQuery('three')).rejects.toBeInstanceOf(BudgetExhaustedError)
    expect(inner.calls, 'must not reach the provider after refusal').toBe(2)
  })

  it('keeps the interactive reserve available to search after background ingest is cut off', async () => {
    // This is the property that stops a bulk import from making search stop working.
    const settings = memorySettings()
    const budget = new BudgetManager(settings, 3, 1)
    const ingest = new BudgetedEmbeddingProvider(fakeInner(), budget, 'background')
    const search = new BudgetedEmbeddingProvider(fakeInner(), budget, 'interactive')

    await ingest.embed(['x'])
    await ingest.embed(['y'])
    await expect(ingest.embed(['z'])).rejects.toBeInstanceOf(BudgetExhaustedError)

    await expect(search.embedQuery('still works')).resolves.toHaveLength(4)
  })

  it('passes through the inner provider’s identity so the model guard still sees the real model', () => {
    const budget = new BudgetManager(memorySettings(), 1000, 100)
    const provider = new BudgetedEmbeddingProvider(fakeInner(2048), budget, 'background')
    expect(provider.model).toBe('nvidia/nemotron-3-embed-1b:free')
    expect(provider.dimensions).toBe(2048)
  })
})

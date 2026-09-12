import { describe, expect, it, afterEach } from 'vitest'
import {
  LocalEmbeddingProvider,
  getLocalEmbeddingProvider,
  LOCAL_EMBEDDING_DIMENSIONS,
  LOCAL_EMBEDDING_MODEL_ID,
  type FastEmbedModel,
} from '@/lib/embeddings/local-provider'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface FakeModelHandle {
  model: FastEmbedModel
  passageEmbedCalls: string[][]
  queryEmbedCalls: string[]
  maxConcurrent: () => number
}

function fakeModel(delayMs = 0): FakeModelHandle {
  let active = 0
  let maxActive = 0
  const passageEmbedCalls: string[][] = []
  const queryEmbedCalls: string[] = []

  const model: FastEmbedModel = {
    async *passageEmbed(texts: string[]) {
      passageEmbedCalls.push(texts)
      active += 1
      maxActive = Math.max(maxActive, active)
      if (delayMs > 0) await sleep(delayMs)
      active -= 1
      yield texts.map(() => [0.1, 0.2, 0.3])
    },
    async queryEmbed(text: string) {
      queryEmbedCalls.push(text)
      return [0.4, 0.5, 0.6]
    },
  }

  return { model, passageEmbedCalls, queryEmbedCalls, maxConcurrent: () => maxActive }
}

const GLOBAL_SINGLETON_KEY = Symbol.for('sieve.embeddings.localProvider')

describe('LocalEmbeddingProvider', () => {
  it('exposes the fixed model id and 384 dimensions', () => {
    const provider = new LocalEmbeddingProvider({ loadModel: async () => fakeModel().model })
    expect(provider.model).toBe(LOCAL_EMBEDDING_MODEL_ID)
    expect(provider.dimensions).toBe(384)
    expect(LOCAL_EMBEDDING_DIMENSIONS).toBe(384)
  })

  it('embeds a 20-chunk item in exactly one passageEmbed() call — proves batching', async () => {
    const handle = fakeModel()
    const provider = new LocalEmbeddingProvider({ loadModel: async () => handle.model })

    const texts = Array.from({ length: 20 }, (_, i) => `chunk ${i}`)
    const vectors = await provider.embed(texts)

    expect(handle.passageEmbedCalls).toHaveLength(1)
    expect(handle.passageEmbedCalls[0]).toHaveLength(20)
    expect(vectors).toHaveLength(20)
  })

  it('returns an empty array for an empty input without loading the model at all', async () => {
    let loadCount = 0
    const provider = new LocalEmbeddingProvider({
      loadModel: async () => {
        loadCount += 1
        return fakeModel().model
      },
    })
    expect(await provider.embed([])).toEqual([])
    expect(loadCount).toBe(0)
  })

  it('normalizes fastembed’s real Float32Array vectors into plain arrays (regression)', async () => {
    // Caught by a live smoke test of `pnpm reembed`, not by this suite's fakes: the installed
    // `fastembed` package actually yields `Float32Array` vectors at runtime, despite its own
    // `.d.ts` claiming `number[]`. `JSON.stringify()` on a `Float32Array` serializes as
    // `{"0":...,"1":...}`, not `[...]` — sqlite-vec's chunk_vec insert rejected exactly that. This
    // fake reproduces the real shape so the fix (Array.from at the provider boundary) has a test.
    // The cast is the point: `FastEmbedModel` (correctly) declares `number[]`, the same way
    // fastembed's own `.d.ts` does — this fake is deliberately lying about its runtime shape the
    // same way the real dependency does.
    const typedArrayModel = {
      async *passageEmbed(texts: string[]) {
        yield texts.map(() => new Float32Array([0.1, 0.2, 0.3]))
      },
      async queryEmbed() {
        return new Float32Array([0.4, 0.5, 0.6])
      },
    } as unknown as FastEmbedModel
    const provider = new LocalEmbeddingProvider({ loadModel: async () => typedArrayModel })

    const [docVector] = await provider.embed(['a'])
    expect(Array.isArray(docVector)).toBe(true)
    expect(JSON.stringify(docVector)?.startsWith('[')).toBe(true) // not "{"0":...}"

    const queryVector = await provider.embedQuery('q')
    expect(Array.isArray(queryVector)).toBe(true)
    expect(JSON.stringify(queryVector)?.startsWith('[')).toBe(true)
  })

  it('embedQuery uses queryEmbed, never passageEmbed — the asymmetric BGE path', async () => {
    const handle = fakeModel()
    const provider = new LocalEmbeddingProvider({ loadModel: async () => handle.model })

    const vector = await provider.embedQuery('what is contextual retrieval')
    expect(handle.queryEmbedCalls).toEqual(['what is contextual retrieval'])
    expect(handle.passageEmbedCalls).toHaveLength(0)
    expect(vector).toEqual([0.4, 0.5, 0.6])
  })

  it('warms the model only once, even under concurrent calls', async () => {
    let loadCount = 0
    const handle = fakeModel()
    const provider = new LocalEmbeddingProvider({
      loadModel: async () => {
        loadCount += 1
        await sleep(5)
        return handle.model
      },
    })

    await Promise.all([provider.warmUp(), provider.embed(['a']), provider.embedQuery('b')])
    expect(loadCount).toBe(1)
  })

  it('retries loading the model on the next call after a load failure (does not cache a rejection forever)', async () => {
    let attempt = 0
    const handle = fakeModel()
    const provider = new LocalEmbeddingProvider({
      loadModel: async () => {
        attempt += 1
        if (attempt === 1) throw new Error('cold cache hiccup')
        return handle.model
      },
    })

    await expect(provider.embed(['x'])).rejects.toThrow('cold cache hiccup')
    const vectors = await provider.embed(['x']) // second attempt should succeed
    expect(vectors).toHaveLength(1)
    expect(attempt).toBe(2)
  })

  it('caps concurrency at 2 by default — a third call waits for a slot', async () => {
    const handle = fakeModel(30)
    const provider = new LocalEmbeddingProvider({ loadModel: async () => handle.model })

    await Promise.all([provider.embed(['a']), provider.embed(['b']), provider.embed(['c'])])
    expect(handle.maxConcurrent()).toBeLessThanOrEqual(2)
  })

  it('respects a custom concurrency limit', async () => {
    const handle = fakeModel(30)
    const provider = new LocalEmbeddingProvider({
      loadModel: async () => handle.model,
      concurrency: 1,
    })

    await Promise.all([provider.embed(['a']), provider.embed(['b']), provider.embed(['c'])])
    expect(handle.maxConcurrent()).toBe(1)
  })
})

describe('getLocalEmbeddingProvider (globalThis singleton)', () => {
  afterEach(() => {
    // Never leak this process-wide singleton into other test files.
    delete (globalThis as unknown as Record<symbol, unknown>)[GLOBAL_SINGLETON_KEY]
  })

  it('returns the same instance on every call, ignoring options after the first', () => {
    const first = getLocalEmbeddingProvider({ concurrency: 5 })
    const second = getLocalEmbeddingProvider({ concurrency: 1 })
    expect(second).toBe(first)
  })
})

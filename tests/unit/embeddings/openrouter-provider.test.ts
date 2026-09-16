import { describe, expect, it, vi } from 'vitest'
import {
  OpenRouterEmbeddingProvider,
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
} from '@/lib/embeddings/openrouter-provider'

function fakeFetch(data: Array<{ embedding: number[]; index: number }>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data, model: DEFAULT_OPENROUTER_EMBEDDING_MODEL }),
  } as unknown as Response)
}

describe('OpenRouterEmbeddingProvider', () => {
  it('embeds N texts in exactly one batched request', async () => {
    const fetchImpl = fakeFetch([
      { embedding: [0.1, 0.1], index: 0 },
      { embedding: [0.2, 0.2], index: 1 },
      { embedding: [0.3, 0.3], index: 2 },
    ])
    const provider = new OpenRouterEmbeddingProvider({ apiKey: 'key', dimensions: 2, fetchImpl })

    const vectors = await provider.embed(['a', 'b', 'c'])

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(vectors).toEqual([
      [0.1, 0.1],
      [0.2, 0.2],
      [0.3, 0.3],
    ])
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key')
    const body = JSON.parse(init.body as string) as { input: string[]; model: string }
    expect(body.input).toEqual(['a', 'b', 'c'])
  })

  it('re-sorts a response that comes back out of index order', async () => {
    const fetchImpl = fakeFetch([
      { embedding: [0.3, 0.3], index: 2 },
      { embedding: [0.1, 0.1], index: 0 },
      { embedding: [0.2, 0.2], index: 1 },
    ])
    const provider = new OpenRouterEmbeddingProvider({ apiKey: 'key', dimensions: 2, fetchImpl })
    const vectors = await provider.embed(['a', 'b', 'c'])
    expect(vectors).toEqual([
      [0.1, 0.1],
      [0.2, 0.2],
      [0.3, 0.3],
    ])
  })

  it('returns an empty array without making a request for empty input', async () => {
    const fetchImpl = vi.fn()
    const provider = new OpenRouterEmbeddingProvider({ apiKey: 'key', dimensions: 2, fetchImpl })
    expect(await provider.embed([])).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('embedQuery sends a single-item request and returns the one vector', async () => {
    const fetchImpl = fakeFetch([{ embedding: [0.9, 0.1], index: 0 }])
    const provider = new OpenRouterEmbeddingProvider({ apiKey: 'key', dimensions: 2, fetchImpl })

    const vector = await provider.embedQuery('search this')
    expect(vector).toEqual([0.9, 0.1])
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { input: string[] }
    expect(body.input).toEqual(['search this'])
  })

  it('applies a configured query instruction prefix only on the query path', async () => {
    const fetchImpl = fakeFetch([{ embedding: [1, 0], index: 0 }])
    const provider = new OpenRouterEmbeddingProvider({
      apiKey: 'key',
      dimensions: 2,
      fetchImpl,
      queryInstructionPrefix: 'query: ',
    })

    await provider.embedQuery('hello')
    const [, queryInit] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect((JSON.parse(queryInit.body as string) as { input: string[] }).input).toEqual([
      'query: hello',
    ])

    await provider.embed(['hello'])
    const [, docInit] = fetchImpl.mock.calls[1] as [string, RequestInit]
    expect((JSON.parse(docInit.body as string) as { input: string[] }).input).toEqual(['hello'])
  })

  it('throws a descriptive error on a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    } as unknown as Response)
    const provider = new OpenRouterEmbeddingProvider({ apiKey: 'key', dimensions: 2, fetchImpl })
    await expect(provider.embed(['x'])).rejects.toThrow(/429/)
  })

  it('defaults to the documented nemotron embedding model', () => {
    const provider = new OpenRouterEmbeddingProvider({ apiKey: 'key', dimensions: 1024 })
    expect(provider.model).toBe(DEFAULT_OPENROUTER_EMBEDDING_MODEL)
    expect(provider.dimensions).toBe(1024)
  })
})

describe('OpenRouterEmbeddingProvider dimension guard', () => {
  it('refuses a response whose width differs from the configured dimension', async () => {
    // ADR 0003's second failure mode, made concrete: a hosted model can be swapped behind a
    // stable `:free` alias. Writing 1024-d vectors into a chunk_vec sized 2048 would either be
    // rejected several frames away by sqlite-vec, or — worse, if the widths happened to line up
    // — stored as vectors that silently never match anything again.
    const fetchImpl = fakeFetch([{ embedding: new Array(1024).fill(0.1), index: 0 }])
    const provider = new OpenRouterEmbeddingProvider({
      apiKey: 'k',
      dimensions: 2048,
      fetchImpl,
    })

    await expect(provider.embedQuery('anything')).rejects.toThrow(/returned 1024-d/)
    await expect(provider.embedQuery('anything')).rejects.toThrow(/2048-d/)
  })

  it('accepts a response that matches the configured dimension', async () => {
    const fetchImpl = fakeFetch([{ embedding: new Array(2048).fill(0.1), index: 0 }])
    const provider = new OpenRouterEmbeddingProvider({ apiKey: 'k', dimensions: 2048, fetchImpl })
    await expect(provider.embedQuery('anything')).resolves.toHaveLength(2048)
  })
})

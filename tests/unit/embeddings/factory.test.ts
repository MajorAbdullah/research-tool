import { describe, expect, it, afterEach } from 'vitest'
import { createEmbeddingProvider, selectEmbeddingProviderFromEnv } from '@/lib/embeddings/factory'
import { LocalEmbeddingProvider } from '@/lib/embeddings/local-provider'
import { OpenRouterEmbeddingProvider } from '@/lib/embeddings/openrouter-provider'

const GLOBAL_SINGLETON_KEY = Symbol.for('sieve.embeddings.localProvider')

describe('selectEmbeddingProviderFromEnv', () => {
  it('defaults to local when EMBEDDING_PROVIDER is unset', () => {
    expect(selectEmbeddingProviderFromEnv({})).toBe('local')
  })

  it('defaults to local for any value other than the literal "openrouter"', () => {
    expect(selectEmbeddingProviderFromEnv({ EMBEDDING_PROVIDER: 'something-else' })).toBe('local')
  })

  it('selects openrouter only for the exact literal', () => {
    expect(selectEmbeddingProviderFromEnv({ EMBEDDING_PROVIDER: 'openrouter' })).toBe('openrouter')
  })
})

describe('createEmbeddingProvider', () => {
  afterEach(() => {
    delete (globalThis as unknown as Record<symbol, unknown>)[GLOBAL_SINGLETON_KEY]
  })

  it('builds the local provider with no further configuration required', () => {
    const provider = createEmbeddingProvider({ provider: 'local' })
    expect(provider).toBeInstanceOf(LocalEmbeddingProvider)
  })

  it('refuses to build the openrouter provider without explicit options — no dimension to guess', () => {
    expect(() => createEmbeddingProvider({ provider: 'openrouter' })).toThrow(/dimension/i)
  })

  it('builds the openrouter provider once explicit options are supplied', () => {
    const provider = createEmbeddingProvider({
      provider: 'openrouter',
      openRouter: { apiKey: 'k', dimensions: 1024 },
    })
    expect(provider).toBeInstanceOf(OpenRouterEmbeddingProvider)
    expect(provider.dimensions).toBe(1024)
  })
})

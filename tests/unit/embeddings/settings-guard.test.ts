import { describe, expect, it } from 'vitest'
import { createInMemorySettingsPort } from '@/lib/ai/settings-store'
import {
  assertEmbeddingModelMatches,
  EmbeddingModelMismatchError,
  recordEmbeddingModel,
} from '@/lib/embeddings/settings-guard'

describe('assertEmbeddingModelMatches', () => {
  it('records the configured model on first boot (nothing stored yet)', () => {
    const store = createInMemorySettingsPort()
    assertEmbeddingModelMatches('bge-small-en-v1.5', store)
    expect(store.get('embedding_model')).toBe('bge-small-en-v1.5')
  })

  it('passes silently when the configured model matches what is stored', () => {
    const store = createInMemorySettingsPort({ embedding_model: 'bge-small-en-v1.5' })
    expect(() => assertEmbeddingModelMatches('bge-small-en-v1.5', store)).not.toThrow()
  })

  it('fails loudly at startup when the configured model does not match — never a silent switch', () => {
    const store = createInMemorySettingsPort({ embedding_model: 'bge-small-en-v1.5' })
    expect(() => assertEmbeddingModelMatches('nvidia/nemotron-3-embed-1b:free', store)).toThrow(
      EmbeddingModelMismatchError,
    )
  })

  it('the mismatch error names both the configured and the stored model', () => {
    const store = createInMemorySettingsPort({ embedding_model: 'old-model' })
    try {
      assertEmbeddingModelMatches('new-model', store)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(EmbeddingModelMismatchError)
      const mismatch = err as EmbeddingModelMismatchError
      expect(mismatch.configuredModel).toBe('new-model')
      expect(mismatch.storedModel).toBe('old-model')
      expect(mismatch.message).toMatch(/pnpm reembed/)
    }
  })
})

describe('recordEmbeddingModel', () => {
  it('overwrites the stored model unconditionally — the only sanctioned way to change it', () => {
    const store = createInMemorySettingsPort({ embedding_model: 'old-model' })
    recordEmbeddingModel('new-model', store)
    expect(store.get('embedding_model')).toBe('new-model')
    // A subsequent boot with the new model now passes instead of throwing.
    expect(() => assertEmbeddingModelMatches('new-model', store)).not.toThrow()
  })
})

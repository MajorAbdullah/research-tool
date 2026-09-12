import { describe, expect, it } from 'vitest'
import { splitIntoStreamChunks } from '@/lib/rag/stream-chunks'

describe('splitIntoStreamChunks', () => {
  it('rejoins to exactly the original text, whitespace included', () => {
    const text = 'vLLM uses PagedAttention [1] for KV-cache management, and continuous batching.'
    expect(splitIntoStreamChunks(text).join('')).toBe(text)
  })

  it('produces more than one chunk for a long answer', () => {
    const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
    const chunks = splitIntoStreamChunks(text)
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('returns a single chunk for a short answer', () => {
    expect(splitIntoStreamChunks('short answer').length).toBe(1)
  })

  it('returns an empty array for empty text', () => {
    expect(splitIntoStreamChunks('')).toEqual([])
  })

  it('handles text with no whitespace at all', () => {
    expect(splitIntoStreamChunks('nospaceshere').join('')).toBe('nospaceshere')
  })
})

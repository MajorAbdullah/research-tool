import { describe, expect, it } from 'vitest'
import { extractCitationIndices, validateCitations, looksLikeRefusal } from '@/lib/rag/citations'

describe('extractCitationIndices', () => {
  it('parses adjacent markers like [1][2]', () => {
    expect(extractCitationIndices('Both repos batch requests [1][2].')).toEqual([1, 2])
  })

  it('parses markers spread across prose, in first-seen order', () => {
    expect(extractCitationIndices('vLLM does X [2]. The paper says Y [1].')).toEqual([2, 1])
  })

  it('dedupes a repeated marker', () => {
    expect(extractCitationIndices('[1] again, still [1].')).toEqual([1])
  })

  it('returns an empty array when there are no markers', () => {
    expect(extractCitationIndices('No citations here.')).toEqual([])
  })
})

describe('validateCitations', () => {
  it('is valid with zero sources regardless of markers (nothing to cite)', () => {
    expect(validateCitations('An uncited sentence.', 0)).toEqual({
      valid: true,
      citedIndices: [],
      hasAnyMarker: false,
    })
  })

  it('is invalid when there are sources but the answer cites nothing', () => {
    const result = validateCitations('An uncited claim about the repo.', 3)
    expect(result.valid).toBe(false)
    expect(result.hasAnyMarker).toBe(false)
  })

  it('is valid when every cited index is in range', () => {
    const result = validateCitations('vLLM uses PagedAttention [1].', 2)
    expect(result.valid).toBe(true)
    expect(result.citedIndices).toEqual([1])
  })

  it('is invalid when a cited index is out of range — a hallucinated reference', () => {
    const result = validateCitations('See [9] for details.', 2)
    expect(result.valid).toBe(false)
    expect(result.hasAnyMarker).toBe(true)
    expect(result.citedIndices).toEqual([9])
  })

  it('is invalid when ANY cited index is out of range, even if others are valid', () => {
    const result = validateCitations('True per [1], but also [9].', 2)
    expect(result.valid).toBe(false)
  })
})

describe('looksLikeRefusal', () => {
  it.each([
    "I don't have anything saved about Kubernetes operators.",
    'Nothing in your library covers this topic.',
    "I don't have any information on that.",
    'I couldn’t find anything about that in your library.',
  ])('recognizes a legitimate "nothing saved" refusal: %s', (text) => {
    expect(looksLikeRefusal(text)).toBe(true)
  })

  it('does not flag an ordinary, well-cited answer as a refusal', () => {
    expect(looksLikeRefusal('vLLM uses PagedAttention for KV-cache management [1].')).toBe(false)
  })
})

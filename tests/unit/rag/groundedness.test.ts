import { describe, expect, it } from 'vitest'
import {
  isPreGenerationGrounded,
  VECTOR_DISTANCE_CEILING,
  INSUFFICIENT_CONTEXT_MESSAGE,
} from '@/lib/rag/groundedness'

describe('isPreGenerationGrounded', () => {
  it('is false when retrieval returned zero items — an empty library or a zero-match query', () => {
    expect(
      isPreGenerationGrounded({ itemCount: 0, hasAnyFtsHit: false, bestVectorDistance: null }),
    ).toBe(false)
    // Even a suspiciously good vector distance can't rescue "hybridSearch returned nothing" —
    // that combination shouldn't occur in practice, but the gate treats itemCount as the
    // authoritative floor regardless.
    expect(
      isPreGenerationGrounded({ itemCount: 0, hasAnyFtsHit: false, bestVectorDistance: 0.1 }),
    ).toBe(false)
  })

  it('is true when FTS matched at all, regardless of vector distance', () => {
    expect(
      isPreGenerationGrounded({ itemCount: 1, hasAnyFtsHit: true, bestVectorDistance: 5 }),
    ).toBe(true)
  })

  it('is true when vector distance is at or under the ceiling, even with no FTS hit', () => {
    expect(
      isPreGenerationGrounded({
        itemCount: 1,
        hasAnyFtsHit: false,
        bestVectorDistance: VECTOR_DISTANCE_CEILING,
      }),
    ).toBe(true)
  })

  it('is false when neither signal clears the bar', () => {
    expect(
      isPreGenerationGrounded({
        itemCount: 1,
        hasAnyFtsHit: false,
        bestVectorDistance: VECTOR_DISTANCE_CEILING + 0.01,
      }),
    ).toBe(false)
  })

  it('is false when there is no vector signal at all and no FTS hit (empty chunk_vec)', () => {
    expect(
      isPreGenerationGrounded({ itemCount: 1, hasAnyFtsHit: false, bestVectorDistance: null }),
    ).toBe(false)
  })
})

describe('INSUFFICIENT_CONTEXT_MESSAGE', () => {
  it('is a non-empty, user-facing sentence — never blank, never a raw error shape', () => {
    expect(INSUFFICIENT_CONTEXT_MESSAGE.length).toBeGreaterThan(10)
    expect(INSUFFICIENT_CONTEXT_MESSAGE).not.toMatch(/error|exception|undefined/i)
  })
})

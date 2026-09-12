import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, type TestDb } from '../../helpers/db'
import { makeUser } from '../../helpers/factories'
import { computeCacheKey, getCachedAnswer, setCachedAnswer } from '@/lib/rag/cache'

describe('computeCacheKey', () => {
  it('is the same for questions differing only in whitespace/case', () => {
    const a = computeCacheKey(1, 'What did I save about attention?', undefined)
    const b = computeCacheKey(1, '  what did i save about   attention?  ', undefined)
    expect(a).toBe(b)
  })

  it('differs across users asking the identical question', () => {
    const a = computeCacheKey(1, 'same question', undefined)
    const b = computeCacheKey(2, 'same question', undefined)
    expect(a).not.toBe(b)
  })

  it('differs across scope filters — a scoped question is a different cache entry', () => {
    const unscoped = computeCacheKey(1, 'same question', undefined)
    const scopedToRepos = computeCacheKey(1, 'same question', { kind: 'github' })
    const scopedToTopic = computeCacheKey(1, 'same question', { topic: 'llm-serving' })
    expect(new Set([unscoped, scopedToRepos, scopedToTopic]).size).toBe(3)
  })

  it('is a genuinely different question -> different key', () => {
    const a = computeCacheKey(1, 'question one', undefined)
    const b = computeCacheKey(1, 'question two', undefined)
    expect(a).not.toBe(b)
  })
})

describe('getCachedAnswer / setCachedAnswer', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeTestDb()
    makeUser(db, 1)
  })
  afterEach(() => db.close())

  it('returns null on a miss', () => {
    expect(getCachedAnswer(db, 1, 'nonexistent-key')).toBeNull()
  })

  it('round-trips exactly what was set', () => {
    const key = computeCacheKey(1, 'what did I save about attention?', undefined)
    setCachedAnswer(db, 1, key, {
      answer: 'vLLM uses PagedAttention [1].',
      sources: [
        {
          index: 1,
          itemId: 5,
          wireId: 'itm_5',
          title: 'vllm',
          kind: 'github',
          canonicalUrl: 'https://x',
        },
      ],
      grounded: true,
    })

    const cached = getCachedAnswer(db, 1, key)
    expect(cached).toEqual({
      answer: 'vLLM uses PagedAttention [1].',
      sources: [
        {
          index: 1,
          itemId: 5,
          wireId: 'itm_5',
          title: 'vllm',
          kind: 'github',
          canonicalUrl: 'https://x',
        },
      ],
      grounded: true,
    })
  })

  it('a second write to the same key overwrites rather than erroring (repeat-question idempotency)', () => {
    const key = computeCacheKey(1, 'q', undefined)
    setCachedAnswer(db, 1, key, { answer: 'first', sources: [], grounded: false })
    setCachedAnswer(db, 1, key, { answer: 'second', sources: [], grounded: true })

    expect(getCachedAnswer(db, 1, key)).toMatchObject({ answer: 'second', grounded: true })
  })

  it('is scoped by user_id — one user cannot read another user’s cache entry via the same key', () => {
    makeUser(db, 2)
    const key = 'a-key-both-users-happen-to-share'
    setCachedAnswer(db, 1, key, { answer: 'user 1 answer', sources: [], grounded: true })

    expect(getCachedAnswer(db, 2, key)).toBeNull()
  })
})

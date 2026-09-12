import { describe, expect, it } from 'vitest'
import { buildFtsMatchExpression, tokenizeForFts, MAX_FTS_TERMS } from '@/lib/search/fts-sanitize'
import { makeTestDb } from '../../helpers/db'
import { makeUser, makeItem } from '../../helpers/factories'
import { ftsSearch } from '@/lib/search/fts-search'

describe('tokenizeForFts', () => {
  it('lowercases and extracts word tokens', () => {
    expect(tokenizeForFts('PagedAttention')).toEqual(['pagedattention'])
  })

  it('splits on punctuation/whitespace', () => {
    expect(tokenizeForFts('4-bit quantization')).toEqual(['4', 'bit', 'quantization'])
  })

  it('dedupes while preserving first-seen order', () => {
    expect(tokenizeForFts('diffusion video diffusion')).toEqual(['diffusion', 'video'])
  })

  it('returns an empty array for pure punctuation/emoji', () => {
    expect(tokenizeForFts('🤯🤯🤯 --- ***')).toEqual([])
  })

  it('caps at MAX_FTS_TERMS', () => {
    const words = Array.from({ length: MAX_FTS_TERMS + 10 }, (_, i) => `word${i}`)
    expect(tokenizeForFts(words.join(' '))).toHaveLength(MAX_FTS_TERMS)
  })
})

describe('buildFtsMatchExpression', () => {
  it('returns null for input with no usable tokens', () => {
    expect(buildFtsMatchExpression('   ')).toBeNull()
    expect(buildFtsMatchExpression('***')).toBeNull()
  })

  it('builds a quoted, OR-joined, prefix-matching expression', () => {
    expect(buildFtsMatchExpression('video diffusion')).toBe('"video"* OR "diffusion"*')
  })

  it('neutralizes FTS5-meaningful syntax instead of passing it through', () => {
    // A stray quote, a bare `*`, `NEAR`, `AND`/`OR`, and a column filter (`title:`) all mean
    // something to FTS5's own parser — none of that literal syntax should survive tokenization.
    const expr = buildFtsMatchExpression('"diffusion NEAR/2 title:hack* AND OR')
    expect(expr).not.toBeNull()
    expect(expr).not.toMatch(/NEAR|title:|AND|OR\)/) // our own literal ' OR ' joiner is fine
    expect(expr).toBe('"diffusion"* OR "near"* OR "2"* OR "title"* OR "hack"* OR "and"* OR "or"*')
  })

  it('never throws fts5 syntax errors against a real MATCH query, however adversarial the input', () => {
    const db = makeTestDb()
    makeUser(db, 1)
    makeItem(db, { id: 1, title: 'Zebra Diffusion' })

    const adversarial = [
      '"unterminated quote',
      'trailing star*',
      'title:hack*',
      'a NEAR/4 b',
      'AND OR NOT',
      '() () ()',
      '',
      '   ',
    ]
    for (const query of adversarial) {
      expect(() => ftsSearch(db, { userId: 1, query, limit: 10 }), `query: ${JSON.stringify(query)}`).not.toThrow()
    }
    db.close()
  })
})

import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { ftsSearch, ftsSnippet } from '@/lib/search/fts-search'
import { makeTestDb, type TestDb } from '../../helpers/db'
import { makeUser, makeItem, tagItem } from '../../helpers/factories'

describe('ftsSearch', () => {
  let db: TestDb
  beforeEach(() => {
    db = makeTestDb()
    makeUser(db, 1)
    makeUser(db, 2)
  })
  afterEach(() => db.close())

  it('prefix-matches: "diffus" finds an item containing "diffusion"', () => {
    makeItem(db, { id: 1, title: 'this changes EVERYTHING', content: 'a video diffusion transformer walkthrough' })
    const hits = ftsSearch(db, { userId: 1, query: 'diffus', limit: 10 })
    expect(hits.map((h) => h.itemId)).toEqual([1])
  })

  it('is case-insensitive', () => {
    makeItem(db, { id: 1, content: 'Uses PagedAttention to manage memory' })
    const hits = ftsSearch(db, { userId: 1, query: 'pagedattention', limit: 10 })
    expect(hits.map((h) => h.itemId)).toEqual([1])
  })

  it('ranks a stronger keyword match above a weaker one', () => {
    makeItem(db, { id: 1, content: 'diffusion diffusion diffusion diffusion model' })
    makeItem(db, { id: 2, content: 'a passing mention of diffusion once' })
    const hits = ftsSearch(db, { userId: 1, query: 'diffusion', limit: 10 })
    expect(hits.map((h) => h.itemId)).toEqual([1, 2])
  })

  it('matches tags via the synthesized items_fts_source view', () => {
    const id = makeItem(db, { id: 1 })
    tagItem(db, id, 'quantization')
    const hits = ftsSearch(db, { userId: 1, query: 'quantization', limit: 10 })
    expect(hits.map((h) => h.itemId)).toEqual([1])
  })

  it('never returns another user\'s item even when its content matches', () => {
    makeItem(db, { id: 1, userId: 2, content: 'video diffusion fine-tuning walkthrough' })
    const hits = ftsSearch(db, { userId: 1, query: 'diffusion', limit: 10 })
    expect(hits).toEqual([])
  })

  it('applies composable filters (kind, status, date range) in the same query', () => {
    makeItem(db, { id: 1, kind: 'github', content: 'a repo about diffusion' })
    makeItem(db, { id: 2, kind: 'video', content: 'a video about diffusion' })
    const hits = ftsSearch(db, {
      userId: 1,
      query: 'diffusion',
      limit: 10,
      filters: { kind: ['video'] },
    })
    expect(hits.map((h) => h.itemId)).toEqual([2])
  })

  it('returns [] for a query with no usable tokens, and for a non-positive limit', () => {
    makeItem(db, { id: 1, content: 'diffusion' })
    expect(ftsSearch(db, { userId: 1, query: '🤯🤯🤯', limit: 10 })).toEqual([])
    expect(ftsSearch(db, { userId: 1, query: 'diffusion', limit: 0 })).toEqual([])
  })

  it('never throws on adversarial input containing FTS5 operator syntax', () => {
    makeItem(db, { id: 1, content: 'diffusion model' })
    expect(() =>
      ftsSearch(db, { userId: 1, query: '"unterminated AND title:hack* NEAR/3', limit: 10 }),
    ).not.toThrow()
  })
})

describe('ftsSnippet', () => {
  let db: TestDb
  beforeEach(() => {
    db = makeTestDb()
    makeUser(db, 1)
  })
  afterEach(() => db.close())

  it('returns a plain-text excerpt with no HTML markup', () => {
    makeItem(db, {
      id: 1,
      content: 'Walkthrough of fine-tuning a video diffusion transformer on consumer hardware.',
    })
    const snippet = ftsSnippet(db, 1, 'diffusion')
    expect(snippet).not.toBeNull()
    expect(snippet).not.toMatch(/<[^>]+>/)
    expect(snippet?.toLowerCase()).toContain('diffusion')
  })

  it('returns null when the item is not itself an FTS match for the query', () => {
    makeItem(db, { id: 1, content: 'completely unrelated content' })
    expect(ftsSnippet(db, 1, 'diffusion')).toBeNull()
  })

  it('returns null for a query with no usable tokens', () => {
    makeItem(db, { id: 1, content: 'diffusion' })
    expect(ftsSnippet(db, 1, '***')).toBeNull()
  })
})

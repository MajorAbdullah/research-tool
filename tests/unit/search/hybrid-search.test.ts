import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import type { EmbeddingProvider } from '@/types/contracts'
import { hybridSearch, ftsOnlySearch, clampLimit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@/lib/search/hybrid-search'
import { decodeSearchCursor } from '@/lib/search/pagination'
import { makeTestDb, fakeEmbedding, type TestDb } from '../../helpers/db'
import { makeUser, makeItem, makeChunk } from '../../helpers/factories'

function fakeEmbeddingProvider(queryVector: readonly number[] = Array.from(fakeEmbedding(1))): EmbeddingProvider {
  return {
    model: 'fake-embedder',
    dimensions: queryVector.length,
    embed: vi.fn(async (texts: string[]) => texts.map(() => [...queryVector])),
    embedQuery: vi.fn(async () => [...queryVector]),
  }
}

describe('clampLimit', () => {
  it('defaults when undefined or NaN', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_PAGE_LIMIT)
    expect(clampLimit(Number.NaN)).toBe(DEFAULT_PAGE_LIMIT)
  })

  it('clamps (never rejects) values outside 1..100', () => {
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(-5)).toBe(1)
    expect(clampLimit(1000)).toBe(MAX_PAGE_LIMIT)
  })

  it('truncates fractional values', () => {
    expect(clampLimit(5.9)).toBe(5)
  })
})

describe('hybridSearch / ftsOnlySearch', () => {
  let db: TestDb
  beforeEach(() => {
    db = makeTestDb()
    makeUser(db, 1)
  })
  afterEach(() => db.close())

  it('finds a semantic-only match (title has no lexical overlap with the query) via the vector half', async () => {
    const reelId = makeItem(db, {
      id: 1,
      title: 'this changes EVERYTHING 🤯',
      content: 'Walkthrough of fine-tuning a video diffusion transformer on consumer hardware.',
    })
    makeChunk(db, reelId, 'Walkthrough of fine-tuning a video diffusion transformer.', { seed: 1 })

    // FTS alone would find nothing (title/content share no words with the literal query text used
    // as the embedding's "seed" here), but the vector provider is stubbed to return exactly the
    // chunk's own embedding, so the vector half must carry this.
    const result = await hybridSearch(db, fakeEmbeddingProvider(Array.from(fakeEmbedding(1))), {
      userId: 1,
      query: 'zzz nonword query zzz',
    })

    expect(result.data.map((d) => d.id)).toEqual(['itm_1'])
    expect(result.data[0]?.score).toBeGreaterThan(0)
    expect(result.data[0]?.snippet).not.toBeNull()
  })

  it('fuses FTS and vector rankings — an item matching both ranks above one matching only one', async () => {
    const both = makeItem(db, { id: 1, content: 'diffusion model walkthrough' })
    makeChunk(db, both, 'diffusion model walkthrough', { seed: 1 })
    const ftsOnly = makeItem(db, { id: 2, content: 'diffusion model walkthrough but different vector' })
    makeChunk(db, ftsOnly, 'diffusion model walkthrough but different vector', { seed: 77 })

    const result = await hybridSearch(db, fakeEmbeddingProvider(Array.from(fakeEmbedding(1))), {
      userId: 1,
      query: 'diffusion model',
    })

    const ids = result.data.map((d) => d.id)
    expect(ids.indexOf('itm_1')).toBeLessThan(ids.indexOf('itm_2'))
  })

  it('ftsOnlySearch never calls the embedding provider and returns the same response shape', () => {
    const item = makeItem(db, { id: 1, content: 'diffusion model' })
    const result = ftsOnlySearch(db, { userId: 1, query: 'diffusion' })
    expect(result.data.map((d) => d.id)).toEqual([`itm_${item}`])
    expect(result.page).toEqual({ next_cursor: null, has_more: false })
  })

  it('paginates without skipping or duplicating across pages', async () => {
    for (let i = 1; i <= 5; i++) {
      const item = makeItem(db, { id: i, content: `diffusion item ${i}` })
      makeChunk(db, item, `diffusion item ${i}`, { seed: i })
    }

    const provider = fakeEmbeddingProvider(Array.from(fakeEmbedding(1)))
    const firstPage = await hybridSearch(db, provider, { userId: 1, query: 'diffusion', limit: 2 })
    expect(firstPage.data).toHaveLength(2)
    expect(firstPage.page.has_more).toBe(true)
    expect(firstPage.page.next_cursor).not.toBeNull()

    const secondPage = await hybridSearch(db, provider, {
      userId: 1,
      query: 'diffusion',
      limit: 2,
      cursor: firstPage.page.next_cursor ?? undefined,
    })
    expect(secondPage.data).toHaveLength(2)

    const seenIds = [...firstPage.data, ...secondPage.data].map((d) => d.id)
    expect(new Set(seenIds).size).toBe(seenIds.length) // no duplicates across pages

    const thirdPage = await hybridSearch(db, provider, {
      userId: 1,
      query: 'diffusion',
      limit: 2,
      cursor: secondPage.page.next_cursor ?? undefined,
    })
    expect(thirdPage.data).toHaveLength(1)
    expect(thirdPage.page.has_more).toBe(false)
    expect(thirdPage.page.next_cursor).toBeNull()
  })

  it('never returns another user\'s item, even for a semantically-identical query vector', async () => {
    makeUser(db, 2)
    const theirs = makeItem(db, { id: 1, userId: 2, content: 'diffusion model' })
    makeChunk(db, theirs, 'diffusion model', { userId: 2, seed: 1 })

    const result = await hybridSearch(db, fakeEmbeddingProvider(Array.from(fakeEmbedding(1))), {
      userId: 1,
      query: 'diffusion',
    })
    expect(result.data).toEqual([])
  })

  it('applies filters end-to-end through the fused result', async () => {
    const repo = makeItem(db, { id: 1, kind: 'github', content: 'diffusion repo' })
    makeChunk(db, repo, 'diffusion repo', { seed: 1 })
    const video = makeItem(db, { id: 2, kind: 'video', content: 'diffusion video' })
    makeChunk(db, video, 'diffusion video', { seed: 1 })

    const result = await hybridSearch(db, fakeEmbeddingProvider(Array.from(fakeEmbedding(1))), {
      userId: 1,
      query: 'diffusion',
      filters: { kind: ['video'] },
    })
    expect(result.data.map((d) => d.id)).toEqual(['itm_2'])
  })

  it('the cursor decodes to the last row\'s own (score, id)', async () => {
    for (let i = 1; i <= 2; i++) {
      const item = makeItem(db, { id: i, content: `diffusion item ${i}` })
      makeChunk(db, item, `diffusion item ${i}`, { seed: i })
    }
    const page = await hybridSearch(db, fakeEmbeddingProvider(Array.from(fakeEmbedding(1))), {
      userId: 1,
      query: 'diffusion',
      limit: 1,
    })
    const cursor = decodeSearchCursor(page.page.next_cursor ?? undefined)
    expect(cursor).toBeDefined()
    expect(cursor?.score).toBe(page.data[0]?.score)
  })
})

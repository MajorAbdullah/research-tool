import { describe, expect, it } from 'vitest'
import { ItemKind } from '@/types/contracts'
import {
  chunkContent,
  SHORT_ITEM_TOKEN_THRESHOLD,
  TARGET_CHUNK_TOKENS,
} from '@/lib/embeddings/chunker'

const baseMeta = {
  userId: 1,
  title: 'My Item',
  url: 'https://example.com/x',
  publishedAt: 1_700_000_000_000,
}

describe('chunkContent — short, self-contained items', () => {
  it('produces exactly one chunk for a 40-word tweet', () => {
    const tweet = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
    const chunks = chunkContent({ ...baseMeta, kind: ItemKind.Social, contentText: tweet })
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.ord).toBe(0)
  })

  it('produces exactly one chunk for a one-line repo description', () => {
    const description = 'A small charting library for terminal dashboards.'
    const chunks = chunkContent({ ...baseMeta, kind: ItemKind.Github, contentText: description })
    expect(chunks).toHaveLength(1)
  })

  it('returns no chunks for empty content', () => {
    expect(chunkContent({ ...baseMeta, kind: ItemKind.Article, contentText: '   ' })).toEqual([])
  })
})

describe('chunkContent — contextual retrieval prefix', () => {
  it('prepends the item title and a human description of its kind before embedding', () => {
    const chunks = chunkContent({
      ...baseMeta,
      title: 'pretty-charts',
      kind: ItemKind.Github,
      contentText: 'Renders bar charts.',
    })
    expect(chunks[0]?.text).toContain('pretty-charts')
    expect(chunks[0]?.text).toContain('a GitHub repository')
    expect(chunks[0]?.text).toContain('Renders bar charts.')
  })

  it('describes each kind distinctly', () => {
    const kinds: Array<[(typeof ItemKind)[keyof typeof ItemKind], string]> = [
      [ItemKind.Video, 'a video'],
      [ItemKind.Article, 'an article'],
      [ItemKind.Social, 'a social media post'],
      [ItemKind.Pdf, 'a PDF document'],
      [ItemKind.Audio, 'an audio recording'],
      [ItemKind.Other, 'a saved item'],
    ]
    for (const [kind, phrase] of kinds) {
      const [chunk] = chunkContent({ ...baseMeta, kind, contentText: 'short body' })
      expect(chunk?.text).toContain(phrase)
    }
  })
})

describe('chunkContent — long content', () => {
  function longArticle(sentenceCount: number): string {
    return Array.from(
      { length: sentenceCount },
      (_, i) => `This is sentence number ${i} in the article.`,
    ).join(' ')
  }

  it('splits into multiple chunks once content exceeds the target chunk size', () => {
    const content = longArticle(400) // comfortably over TARGET_CHUNK_TOKENS
    const chunks = chunkContent({ ...baseMeta, kind: ItemKind.Article, contentText: content })
    expect(chunks.length).toBeGreaterThan(1)
    chunks.forEach((c, i) => expect(c.ord).toBe(i))
  })

  it('never splits mid-sentence — every chunk body ends at a sentence boundary', () => {
    const content = longArticle(400)
    const chunks = chunkContent({ ...baseMeta, kind: ItemKind.Article, contentText: content })
    for (const chunk of chunks.slice(0, -1)) {
      const body = chunk.text.split('\n\n').slice(1).join('\n\n')
      expect(body.trim().endsWith('.')).toBe(true)
    }
  })

  it('overlaps consecutive chunks so a boundary sentence appears in both', () => {
    const content = longArticle(400)
    const chunks = chunkContent({ ...baseMeta, kind: ItemKind.Article, contentText: content })
    expect(chunks.length).toBeGreaterThan(1)
    const first = chunks[0]?.text ?? ''
    const second = chunks[1]?.text ?? ''
    // The last sentence of chunk 0 should reappear near the start of chunk 1.
    const lastSentenceOfFirst =
      first
        .trim()
        .split(/(?<=\.)\s+/)
        .at(-1) ?? ''
    expect(lastSentenceOfFirst.length).toBeGreaterThan(0)
    expect(second).toContain(lastSentenceOfFirst.replace(/\.$/, ''))
  })

  it('carries source metadata onto every chunk', () => {
    const content = longArticle(400)
    const chunks = chunkContent({ ...baseMeta, kind: ItemKind.Article, contentText: content })
    for (const chunk of chunks) {
      expect(chunk.userId).toBe(baseMeta.userId)
      expect(chunk.title).toBe(baseMeta.title)
      expect(chunk.url).toBe(baseMeta.url)
      expect(chunk.publishedAt).toBe(baseMeta.publishedAt)
    }
  })

  it('keeps each chunk body within a reasonable multiple of the target token budget', () => {
    const content = longArticle(400)
    const chunks = chunkContent({ ...baseMeta, kind: ItemKind.Article, contentText: content })
    for (const chunk of chunks) {
      // Generous slack: contextual prefix + one sentence that might slightly overshoot.
      expect(chunk.text.length).toBeLessThan(TARGET_CHUNK_TOKENS * 4 * 1.5)
    }
  })
})

describe('SHORT_ITEM_TOKEN_THRESHOLD', () => {
  it('is well under one full target chunk', () => {
    expect(SHORT_ITEM_TOKEN_THRESHOLD).toBeLessThan(TARGET_CHUNK_TOKENS)
  })
})

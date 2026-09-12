import { describe, expect, it } from 'vitest'
import { ExtractionTier } from '@/types/contracts'
import { ArticleExtractor } from '@/lib/extractors/article'
import { createFakeHttpClient, fixtureText, networkError, respondWith } from './helpers/fake-http'

const CLEAN_ARTICLE = fixtureText('article/clean-article-client.html')
const SERVER_ARTICLE = fixtureText('article/server-fetch-article.html')
const CLOUDFLARE_BLOCKED = fixtureText('article/cloudflare-blocked.html')
const THIN_CONTENT = fixtureText('article/thin-content.html')

const URL = 'https://example-blog.test/posts/why-we-moved-our-backups'

describe('ArticleExtractor', () => {
  it('matches any http(s) URL', () => {
    const extractor = new ArticleExtractor()
    expect(extractor.matches('https://example.com/anything')).toBe(true)
    expect(extractor.matches('http://example.com/anything')).toBe(true)
    expect(extractor.matches('ftp://example.com/file')).toBe(false)
  })

  it('rung 1: extracts the real article from client-captured HTML as "full"', async () => {
    const extractor = new ArticleExtractor({
      http: createFakeHttpClient([
        { match: URL, outcomes: [networkError('should never be called')] },
      ]),
    })

    const result = await extractor.extract(URL, { html: CLEAN_ARTICLE })

    expect(result.extractionTier).toBe(ExtractionTier.Full)
    expect(result.title).toBe('Why We Moved Our Backups Off the Cloud')
    expect(result.author).toBe('Priya Natarajan')
    expect(result.publishedAt).toBe(Date.parse('2026-03-14T09:00:00Z'))
    expect(result.contentText).toContain('untested backups are a false sense of security')
  })

  it('rung 2: falls back to a server fetch + Readability as "full" when there is no client hint', async () => {
    const extractor = new ArticleExtractor({
      http: createFakeHttpClient([{ match: URL, outcomes: [respondWith(SERVER_ARTICLE)] }]),
    })

    const result = await extractor.extract(URL)

    expect(result.extractionTier).toBe(ExtractionTier.Full)
    expect(result.title).toBe('The Free Tier Is a Constraint, Not a Discount')
    expect(result.author).toBe('Dee Okafor')
    expect(result.contentText).toContain('one structured call per item')
  })

  it('falls through a too-thin client hint to a successful server fetch', async () => {
    const extractor = new ArticleExtractor({
      http: createFakeHttpClient([{ match: URL, outcomes: [respondWith(SERVER_ARTICLE)] }]),
    })

    // The "hint" here is a Cloudflare challenge page — too thin for Readability to treat as an
    // article — so this proves the ladder falls through to rung 2 rather than getting stuck.
    const result = await extractor.extract(URL, { html: CLOUDFLARE_BLOCKED })

    expect(result.extractionTier).toBe(ExtractionTier.Full)
    expect(result.title).toBe('The Free Tier Is a Constraint, Not a Discount')
  })

  it('degrades a Cloudflare-blocked fetch to metadata_only WITHOUT throwing', async () => {
    const extractor = new ArticleExtractor({
      http: createFakeHttpClient([
        { match: URL, outcomes: [respondWith(CLOUDFLARE_BLOCKED, { status: 403 })] },
      ]),
    })

    const result = await extractor.extract(URL)

    expect(result.extractionTier).toBe(ExtractionTier.MetadataOnly)
    // Truthful degradation: the actual challenge-page title, not a fabricated "success".
    expect(result.title).toBe('Just a moment...')
    expect(result.contentText).toBe('Just a moment...')
  })

  it('degrades thin-but-real content (nav/links, no article body) to metadata_only using OG tags', async () => {
    const extractor = new ArticleExtractor({
      http: createFakeHttpClient([{ match: URL, outcomes: [respondWith(THIN_CONTENT)] }]),
    })

    const result = await extractor.extract(URL)

    expect(result.extractionTier).toBe(ExtractionTier.MetadataOnly)
    expect(result.title).toBe("Posts tagged 'self-hosting'")
    expect(result.contentText).toBe('Every Signal Loss post filed under self-hosting.')
    expect(result.thumbnailUrl).toBe('https://example-blog.test/static/tag-card.png')
  })

  it('degrades a total network failure to metadata_only using a URL-derived title, never throwing', async () => {
    const extractor = new ArticleExtractor({
      http: createFakeHttpClient([{ match: URL, outcomes: [networkError('ECONNREFUSED')] }]),
    })

    const result = await extractor.extract(URL)

    expect(result.extractionTier).toBe(ExtractionTier.MetadataOnly)
    expect(result.title).toBe('why we moved our backups')
    expect(result.contentText).toContain(URL)
  })
})

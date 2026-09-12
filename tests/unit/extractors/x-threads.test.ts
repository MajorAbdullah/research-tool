import { describe, expect, it } from 'vitest'
import { ExtractionTier } from '@/types/contracts'
import { XThreadsExtractor } from '@/lib/extractors/x-threads'
import { createFakeHttpClient, fixtureText, networkError, respondWith } from './helpers/fake-http'

const THREAD_8_POSTS = fixtureText('x/thread-8-posts.html')
const SINGLE_TWEET_OG = fixtureText('x/single-tweet-og.html')
const STATUS_URL = 'https://x.com/sieve_build/status/1953405076756570301'

describe('XThreadsExtractor', () => {
  it('matches x.com, twitter.com (via canonicalization), and threads hosts', () => {
    const extractor = new XThreadsExtractor()
    expect(extractor.matches(STATUS_URL)).toBe(true)
    expect(extractor.matches('https://twitter.com/sieve_build/status/1')).toBe(true)
    expect(extractor.matches('https://www.threads.net/@sieve_build/post/abc')).toBe(true)
    expect(extractor.matches('https://example.com/status/1')).toBe(false)
  })

  it('rung 1: walks an 8-post thread capture, concatenating posts in order, as "full"', async () => {
    const extractor = new XThreadsExtractor({
      http: createFakeHttpClient([
        { match: STATUS_URL, outcomes: [networkError('must not be called')] },
      ]),
    })

    const result = await extractor.extract(STATUS_URL, { html: THREAD_8_POSTS })

    expect(result.extractionTier).toBe(ExtractionTier.Full)
    expect(result.kindFields).toEqual({ postCount: 8 })
    expect(result.author).toBe('sieve_build')

    const contentText = result.contentText
    const firstIdx = contentText.indexOf('We kept losing YouTube videos')
    const fourthIdx = contentText.indexOf('rendered transcript panel')
    const eighthIdx = contentText.indexOf('Every item records which rung')

    expect(firstIdx).toBeGreaterThanOrEqual(0)
    expect(fourthIdx).toBeGreaterThan(firstIdx)
    expect(eighthIdx).toBeGreaterThan(fourthIdx)
  })

  it('rung 2: falls back to OG tags as "partial" when there is no client capture', async () => {
    const extractor = new XThreadsExtractor({
      http: createFakeHttpClient([{ match: STATUS_URL, outcomes: [respondWith(SINGLE_TWEET_OG)] }]),
    })

    const result = await extractor.extract(STATUS_URL)

    expect(result.extractionTier).toBe(ExtractionTier.Partial)
    expect(result.title).toBe('sieve.build on X')
    expect(result.contentText).toContain('client capture first, server fallback second')
    expect(result.thumbnailUrl).toBe('https://pbs.twimg.com/profile_images/sample/sieve_build.jpg')
  })

  it('falls back to rung 2 when the captured HTML has no post articles at all (e.g. a generic Threads capture)', async () => {
    const extractor = new XThreadsExtractor({
      http: createFakeHttpClient([{ match: STATUS_URL, outcomes: [respondWith(SINGLE_TWEET_OG)] }]),
    })

    const result = await extractor.extract(STATUS_URL, {
      html: '<html><body><nav>just chrome</nav></body></html>',
    })

    expect(result.extractionTier).toBe(ExtractionTier.Partial)
    expect(result.title).toBe('sieve.build on X')
  })

  it('degrades a total network failure to metadata_only using the URL alone, never throwing', async () => {
    const extractor = new XThreadsExtractor({
      http: createFakeHttpClient([{ match: STATUS_URL, outcomes: [networkError('rate limited')] }]),
    })

    const result = await extractor.extract(STATUS_URL)

    expect(result.extractionTier).toBe(ExtractionTier.MetadataOnly)
    expect(result.contentText).toBe(STATUS_URL)
  })
})

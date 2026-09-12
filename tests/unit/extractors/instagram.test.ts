import { describe, expect, it } from 'vitest'
import { ExtractionTier } from '@/types/contracts'
import { InstagramExtractor } from '@/lib/extractors/instagram'
import { createFakeHttpClient, fixtureText, networkError, respondWith } from './helpers/fake-http'

const OEMBED_SUCCESS = fixtureText('instagram/oembed-success.json')
const REEL_URL = 'https://www.instagram.com/reel/Cabc123XYZ/'

describe('InstagramExtractor', () => {
  it('matches instagram.com URLs and nothing else', () => {
    const extractor = new InstagramExtractor()
    expect(extractor.matches(REEL_URL)).toBe(true)
    expect(extractor.matches('https://example.com/reel/abc')).toBe(false)
  })

  it('rung 1: uses the share-sheet caption as "full", enriched with oEmbed metadata', async () => {
    const extractor = new InstagramExtractor({
      http: createFakeHttpClient([{ match: 'oembed', outcomes: [respondWith(OEMBED_SUCCESS)] }]),
    })

    const caption = 'Shipping the extraction ladder today! #buildinpublic'
    const result = await extractor.extract(REEL_URL, { caption })

    expect(result.extractionTier).toBe(ExtractionTier.Full)
    expect(result.contentText).toBe(caption)
    expect(result.title).toBe('A behind-the-scenes look at the extraction ladder diagram')
    expect(result.author).toBe('sieve.build')
    expect(result.thumbnailUrl).toBe('https://scontent.cdninstagram.com/v/t51.2885-15/sample_thumb.jpg')
    expect(result.kindFields).toEqual({ source: 'share_sheet_caption', needsNote: false })
  })

  it('rung 1 still succeeds as "full" even if the best-effort oEmbed call fails', async () => {
    const extractor = new InstagramExtractor({
      http: createFakeHttpClient([{ match: 'oembed', outcomes: [networkError('oembed down')] }]),
    })

    const result = await extractor.extract(REEL_URL, { caption: 'just the caption' })

    expect(result.extractionTier).toBe(ExtractionTier.Full)
    expect(result.contentText).toBe('just the caption')
    expect(result.title).toBeUndefined()
  })

  it('rung 2: no caption, but oEmbed metadata succeeds — "partial"', async () => {
    const extractor = new InstagramExtractor({
      http: createFakeHttpClient([{ match: 'oembed', outcomes: [respondWith(OEMBED_SUCCESS)] }]),
    })

    const result = await extractor.extract(REEL_URL)

    expect(result.extractionTier).toBe(ExtractionTier.Partial)
    expect(result.title).toBe('A behind-the-scenes look at the extraction ladder diagram')
    expect(result.contentText).toBe('A behind-the-scenes look at the extraction ladder diagram')
    expect(result.kindFields).toEqual({ source: 'oembed', needsNote: false })
  })

  it('degrades to metadata_only with a needsNote flag when nothing at all is available', async () => {
    const extractor = new InstagramExtractor({
      http: createFakeHttpClient([{ match: 'oembed', outcomes: [respondWith('', { status: 400 })] }]),
    })

    const result = await extractor.extract(REEL_URL)

    expect(result.extractionTier).toBe(ExtractionTier.MetadataOnly)
    expect(result.contentText).toBe(`Instagram post — no caption captured: ${REEL_URL}`)
    expect(result.kindFields).toEqual({ source: 'none', needsNote: true })
  })
})

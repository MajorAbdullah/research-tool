import { describe, expect, it } from 'vitest'
import { ExtractionTier } from '@/types/contracts'
import { YoutubeExtractor } from '@/lib/extractors/youtube'
import { createFakeHttpClient, fixtureText, networkError, respondWith } from './helpers/fake-http'

const OEMBED_SUCCESS = fixtureText('youtube/oembed-success.json')
const TIMEDTEXT_SUCCESS = fixtureText('youtube/timedtext-success.json')

const WATCH_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const EXPECTED_SERVER_TRANSCRIPT =
  "Today we're going to build a local search index using SQLite's FTS5 " +
  'extension, fused with a small vector table using reciprocal rank fusion.'

describe('YoutubeExtractor', () => {
  it('matches youtube.com/watch and youtu.be URLs, not unrelated URLs', () => {
    const extractor = new YoutubeExtractor()
    expect(extractor.matches(WATCH_URL)).toBe(true)
    expect(extractor.matches('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
    expect(extractor.matches('https://example.com/watch?v=dQw4w9WgXcQ')).toBe(false)
  })

  it('rung 1: uses the client-captured transcript as "full", enriched with oEmbed metadata', async () => {
    const extractor = new YoutubeExtractor({
      http: createFakeHttpClient([{ match: '/oembed', outcomes: [respondWith(OEMBED_SUCCESS)] }]),
    })

    const transcript = 'This is the client-captured transcript text for the video.'
    const result = await extractor.extract(WATCH_URL, { transcript })

    expect(result.extractionTier).toBe(ExtractionTier.Full)
    expect(result.contentText).toBe(transcript)
    expect(result.title).toBe('Building a Local-First Search Index With SQLite FTS5')
    expect(result.author).toBe('Sieve Engineering')
    expect(result.thumbnailUrl).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
    expect(result.kindFields).toMatchObject({
      videoId: 'dQw4w9WgXcQ',
      transcriptSource: 'client_capture',
    })
  })

  it('rung 1 still succeeds as "full" even if the best-effort oEmbed call fails', async () => {
    const extractor = new YoutubeExtractor({
      http: createFakeHttpClient([{ match: '/oembed', outcomes: [networkError('oembed down')] }]),
    })

    const result = await extractor.extract(WATCH_URL, { transcript: 'client transcript text' })

    expect(result.extractionTier).toBe(ExtractionTier.Full)
    expect(result.contentText).toBe('client transcript text')
    expect(result.title).toBeUndefined()
  })

  it('rung 2: a successful server-side timedtext scrape is "partial", not "full"', async () => {
    const extractor = new YoutubeExtractor({
      http: createFakeHttpClient([
        { match: '/oembed', outcomes: [respondWith(OEMBED_SUCCESS)] },
        { match: '/api/timedtext', outcomes: [respondWith(TIMEDTEXT_SUCCESS)] },
      ]),
    })

    const result = await extractor.extract(WATCH_URL)

    expect(result.extractionTier).toBe(ExtractionTier.Partial)
    expect(result.contentText).toBe(EXPECTED_SERVER_TRANSCRIPT)
    expect(result.title).toBe('Building a Local-First Search Index With SQLite FTS5')
    expect(result.kindFields).toMatchObject({ transcriptSource: 'server_timedtext' })
  })

  it('a 429 on timedtext yields "partial" (via oEmbed metadata), never an exception', async () => {
    const extractor = new YoutubeExtractor({
      http: createFakeHttpClient([
        { match: '/oembed', outcomes: [respondWith(OEMBED_SUCCESS)] },
        { match: '/api/timedtext', outcomes: [respondWith('', { status: 429 })] },
      ]),
    })

    const result = await extractor.extract(WATCH_URL)

    expect(result.extractionTier).toBe(ExtractionTier.Partial)
    expect(result.title).toBe('Building a Local-First Search Index With SQLite FTS5')
    expect(result.kindFields).toMatchObject({ transcriptSource: 'none' })
  })

  it('degrades to metadata_only when both oEmbed and timedtext fail, never throwing', async () => {
    const extractor = new YoutubeExtractor({
      http: createFakeHttpClient([
        { match: '/oembed', outcomes: [respondWith('', { status: 429 })] },
        { match: '/api/timedtext', outcomes: [networkError('blocked')] },
      ]),
    })

    const result = await extractor.extract(WATCH_URL)

    expect(result.extractionTier).toBe(ExtractionTier.MetadataOnly)
    expect(result.contentText).toBe('YouTube video dQw4w9WgXcQ')
    expect(result.thumbnailUrl).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
    expect(result.title).toBeUndefined()
  })
})

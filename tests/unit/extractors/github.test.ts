import { describe, expect, it } from 'vitest'
import { ExtractionTier } from '@/types/contracts'
import { ExtractionError } from '@/lib/extractors/errors'
import { GithubExtractor } from '@/lib/extractors/github'
import { createFakeHttpClient, fixtureText, respondWith } from './helpers/fake-http'

const REPO_URL = /^https:\/\/api\.github\.com\/repos\/torvalds\/linux$/
const README_URL = /^https:\/\/api\.github\.com\/repos\/torvalds\/linux\/readme$/

const REPO_JSON = fixtureText('github/torvalds-linux-repo.json')
const README_MARKDOWN = fixtureText('github/torvalds-linux-readme.md')
const NOT_FOUND_JSON = fixtureText('github/not-found.json')
const RATE_LIMITED_JSON = fixtureText('github/rate-limited.json')

function readmeApiResponse(markdown: string): string {
  return JSON.stringify({
    content: Buffer.from(markdown, 'utf-8').toString('base64'),
    encoding: 'base64',
  })
}

describe('GithubExtractor', () => {
  it('matches github.com repo URLs and nothing else', () => {
    const extractor = new GithubExtractor()
    expect(extractor.matches('https://github.com/torvalds/linux')).toBe(true)
    expect(extractor.matches('https://github.com/torvalds/linux/blob/master/README')).toBe(true)
    expect(extractor.matches('https://example.com/torvalds/linux')).toBe(false)
    expect(extractor.matches('https://github.com/torvalds')).toBe(false)
  })

  it('extracts real repo metadata and README content as extraction_tier "full"', async () => {
    const extractor = new GithubExtractor({
      token: 'test-token',
      http: createFakeHttpClient([
        { match: README_URL, outcomes: [respondWith(readmeApiResponse(README_MARKDOWN))] },
        { match: REPO_URL, outcomes: [respondWith(REPO_JSON)] },
      ]),
    })

    const result = await extractor.extract('https://github.com/torvalds/linux')

    expect(result.extractionTier).toBe(ExtractionTier.Full)
    expect(result.title).toBe('torvalds/linux')
    expect(result.author).toBe('torvalds')
    expect(result.thumbnailUrl).toBe('https://avatars.githubusercontent.com/u/1024025?v=4')
    expect(result.publishedAt).toBe(Date.parse('2011-09-04T22:48:12Z'))

    // Real values from the fixture, not just "some object came back".
    expect(result.kindFields).toEqual({
      what_it_does: 'Linux kernel source tree',
      language: 'C',
      stars: 191234,
      license: 'GPL-2.0',
      last_commit: Date.parse('2026-09-10T19:22:07Z'),
    })

    // The README fixture's actual text, not a placeholder.
    expect(result.contentText).toContain('Documentation/admin-guide/README.rst')
    expect(result.contentText).toContain('Linux kernel source tree')
  })

  it('still returns "full" when the README fetch fails — README is best-effort, not tier-affecting', async () => {
    const extractor = new GithubExtractor({
      http: createFakeHttpClient([
        { match: README_URL, outcomes: [respondWith(NOT_FOUND_JSON, { status: 404 })] },
        { match: REPO_URL, outcomes: [respondWith(REPO_JSON)] },
      ]),
    })

    const result = await extractor.extract('https://github.com/torvalds/linux')

    expect(result.extractionTier).toBe(ExtractionTier.Full)
    expect(result.contentText).toBe('Linux kernel source tree')
    expect(result.kindFields?.['stars']).toBe(191234)
  })

  it('throws a not_found ExtractionError on a 404, and never returns metadata_only', async () => {
    const extractor = new GithubExtractor({
      http: createFakeHttpClient([
        { match: REPO_URL, outcomes: [respondWith(NOT_FOUND_JSON, { status: 404 })] },
      ]),
    })

    await expect(extractor.extract('https://github.com/torvalds/linux')).rejects.toMatchObject({
      code: 'not_found',
      retryable: false,
    })
  })

  it('throws a rate_limited ExtractionError with the reset time surfaced, on a rate-limited 403', async () => {
    const resetAtSeconds = Math.floor(Date.now() / 1000) + 900
    const extractor = new GithubExtractor({
      http: createFakeHttpClient([
        {
          match: REPO_URL,
          outcomes: [
            respondWith(RATE_LIMITED_JSON, {
              status: 403,
              headers: {
                'x-ratelimit-remaining': '0',
                'x-ratelimit-reset': String(resetAtSeconds),
              },
            }),
          ],
        },
      ]),
    })

    let caught: unknown
    try {
      await extractor.extract('https://github.com/torvalds/linux')
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ExtractionError)
    const error = caught as ExtractionError
    expect(error.code).toBe('rate_limited')
    expect(error.retryable).toBe(true)
    expect(error.retryAfterMs).toBeGreaterThan(0)
  })

  it('sends the configured token as a bearer header', async () => {
    const calls: { url: string }[] = []
    let sawAuthHeader = false
    const extractor = new GithubExtractor({
      token: 'secret-pat',
      http: {
        async request(url, options) {
          calls.push({ url })
          if (options?.headers?.['authorization'] === 'Bearer secret-pat') sawAuthHeader = true
          if (url.endsWith('/readme'))
            return { status: 404, ok: false, headers: {}, body: Buffer.from('') }
          return { status: 200, ok: true, headers: {}, body: Buffer.from(REPO_JSON) }
        },
      },
    })

    await extractor.extract('https://github.com/torvalds/linux')
    expect(sawAuthHeader).toBe(true)
    expect(calls.length).toBeGreaterThan(0)
  })
})

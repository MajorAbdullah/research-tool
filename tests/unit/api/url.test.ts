import { describe, expect, it } from 'vitest'
import { canonicalizeUrl, guessKind, hashUrl, isHttpUrl } from '@/services/url'

describe('isHttpUrl', () => {
  it('accepts http and https', () => {
    expect(isHttpUrl('http://example.com')).toBe(true)
    expect(isHttpUrl('https://example.com/path?q=1')).toBe(true)
  })

  it('rejects non-http(s) schemes and malformed input', () => {
    expect(isHttpUrl('ftp://example.com')).toBe(false)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl('not a url')).toBe(false)
    expect(isHttpUrl('')).toBe(false)
  })
})

describe('canonicalizeUrl', () => {
  it('strips utm_* and the docs-named tracking params', () => {
    const url = canonicalizeUrl(
      'https://example.com/article?utm_source=x&utm_medium=y&si=abc&igshid=def&id=keep',
    )
    expect(url).toBe('https://example.com/article?id=keep')
  })

  it('lowercases scheme and host but leaves path casing alone', () => {
    expect(canonicalizeUrl('HTTPS://Example.COM/Some-Path')).toBe('https://example.com/Some-Path')
  })

  it('drops the fragment and a trailing slash on a non-root path', () => {
    expect(canonicalizeUrl('https://example.com/a/#section')).toBe('https://example.com/a')
  })

  it('keeps the root path slash', () => {
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/')
  })

  it('drops the default port for the scheme', () => {
    expect(canonicalizeUrl('https://example.com:443/a')).toBe('https://example.com/a')
    expect(canonicalizeUrl('http://example.com:80/a')).toBe('http://example.com/a')
  })

  it('sorts remaining query params so param order does not affect the dedup hash', () => {
    expect(canonicalizeUrl('https://example.com/a?b=2&a=1')).toBe(
      canonicalizeUrl('https://example.com/a?a=1&b=2'),
    )
  })
})

describe('hashUrl', () => {
  it('is deterministic for the same canonical url', () => {
    const a = hashUrl(canonicalizeUrl('https://example.com/a?utm_source=x'))
    const b = hashUrl(canonicalizeUrl('https://example.com/a'))
    expect(a).toBe(b)
  })

  it('differs for different urls', () => {
    expect(hashUrl('https://example.com/a')).not.toBe(hashUrl('https://example.com/b'))
  })
})

describe('guessKind', () => {
  it.each([
    ['https://github.com/anthropics/claude-code', 'github'],
    ['https://www.youtube.com/watch?v=abc', 'video'],
    ['https://youtu.be/abc', 'video'],
    ['https://www.instagram.com/reel/abc/', 'social'],
    ['https://x.com/someone/status/1', 'social'],
    ['https://open.spotify.com/episode/abc', 'audio'],
    ['https://example.com/whitepaper.pdf', 'pdf'],
    ['https://some-random-blog.example/post', 'article'],
  ])('classifies %s as %s', (url, kind) => {
    expect(guessKind(url)).toBe(kind)
  })
})

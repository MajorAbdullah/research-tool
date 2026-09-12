import { describe, expect, it } from 'vitest'
import { canonicalizeUrlForDedupe, computeUrlHash } from '../../../src/lib/importers/url-hash'

describe('canonicalizeUrlForDedupe', () => {
  it('lowercases the hostname', () => {
    expect(canonicalizeUrlForDedupe('https://EXAMPLE.com/Path')).toBe('https://example.com/Path')
  })

  it('strips the fragment', () => {
    expect(canonicalizeUrlForDedupe('https://example.com/page#section')).toBe(
      'https://example.com/page',
    )
  })

  it('strips utm_* and known tracking params but keeps other query params', () => {
    const result = canonicalizeUrlForDedupe(
      'https://example.com/page?utm_source=whatsapp&utm_medium=chat&id=42&si=abc',
    )
    expect(result).toBe('https://example.com/page?id=42')
  })

  it('strips a trailing slash on a non-root path', () => {
    expect(canonicalizeUrlForDedupe('https://example.com/page/')).toBe('https://example.com/page')
  })

  it('keeps the trailing slash on a bare root path', () => {
    expect(canonicalizeUrlForDedupe('https://example.com/')).toBe('https://example.com/')
  })

  it('falls back to a lowercased/trimmed string for an unparseable URL', () => {
    expect(canonicalizeUrlForDedupe('  Not-A-Real-Url  ')).toBe('not-a-real-url')
  })
})

describe('computeUrlHash', () => {
  it('produces the same hash for two URLs that only differ by tracking params', () => {
    const a = computeUrlHash('https://example.com/page?utm_source=whatsapp')
    const b = computeUrlHash('https://example.com/page?utm_campaign=foo')
    expect(a).toBe(b)
  })

  it('produces the same hash regardless of hostname casing', () => {
    const a = computeUrlHash('https://Example.com/page')
    const b = computeUrlHash('https://example.com/page')
    expect(a).toBe(b)
  })

  it('produces different hashes for genuinely different URLs', () => {
    const a = computeUrlHash('https://example.com/page-one')
    const b = computeUrlHash('https://example.com/page-two')
    expect(a).not.toBe(b)
  })

  it('is a 64-character hex sha256 digest', () => {
    const hash = computeUrlHash('https://example.com/page')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('honors a custom canonicalizer override', () => {
    const hash = computeUrlHash('anything', () => 'fixed-value')
    expect(hash).toBe(computeUrlHash('something-else', () => 'fixed-value'))
  })
})

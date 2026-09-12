import { describe, expect, it, vi } from 'vitest'
import { canonicalizeUrl, canonicalizeUrlSync } from '@/lib/extractors/canonicalize'

describe('canonicalizeUrlSync', () => {
  const cases: Array<[label: string, input: string, expected: string]> = [
    [
      'strips a single utm_ param',
      'https://example.com/post?utm_source=newsletter',
      'https://example.com/post',
    ],
    [
      'strips multiple utm_ params, keeps the rest',
      'https://example.com/post?utm_source=x&utm_medium=email&id=5',
      'https://example.com/post?id=5',
    ],
    [
      'strips the YouTube "si" share param',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc123',
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
    ],
    [
      'strips igshid',
      'https://www.instagram.com/reel/Cabc123XYZ/?igshid=abcdef',
      'https://instagram.com/reel/Cabc123XYZ',
    ],
    [
      'strips fbclid',
      'https://x.com/user/status/12345?fbclid=xyz',
      'https://x.com/user/status/12345',
    ],
    ['strips ref', 'https://example.com/article?ref=homepage', 'https://example.com/article'],
    [
      'strips utm_/fbclid/ref together on one URL',
      'https://example.com/?utm_source=a&fbclid=b&ref=c',
      'https://example.com',
    ],
    [
      'rewrites youtu.be/<id> to youtube.com/watch?v=<id>',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
    ],
    [
      'youtu.be rewrite strips si but keeps a real param like t',
      'https://youtu.be/dQw4w9WgXcQ?si=xyz789&t=30',
      'https://youtube.com/watch?v=dQw4w9WgXcQ&t=30',
    ],
    [
      'youtu.be and www.youtube.com forms of the same video converge',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc123',
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
    ],
    [
      'm.youtube.com aliases to youtube.com',
      'https://m.youtube.com/watch?v=abc123',
      'https://youtube.com/watch?v=abc123',
    ],
    [
      'twitter.com aliases to x.com',
      'https://twitter.com/user/status/12345',
      'https://x.com/user/status/12345',
    ],
    [
      'github.com/owner/repo is already canonical',
      'https://github.com/torvalds/linux',
      'https://github.com/torvalds/linux',
    ],
    [
      'strips a .git suffix',
      'https://github.com/torvalds/linux.git',
      'https://github.com/torvalds/linux',
    ],
    [
      'collapses a deep github sub-path to owner/repo',
      'https://github.com/torvalds/linux/blob/master/README',
      'https://github.com/torvalds/linux',
    ],
    [
      'collapses a trailing slash on a github repo URL',
      'https://github.com/torvalds/linux/',
      'https://github.com/torvalds/linux',
    ],
    [
      'lowercases the github host but preserves owner/repo case',
      'https://GITHUB.com/Torvalds/Linux',
      'https://github.com/Torvalds/Linux',
    ],
    [
      'a github user page (single path segment) is left alone besides host/slash normalization',
      'https://github.com/torvalds',
      'https://github.com/torvalds',
    ],
    [
      'lowercases scheme and host, preserves path case, strips trailing slash',
      'HTTP://EXAMPLE.COM/Path/Name/',
      'http://example.com/Path/Name',
    ],
    ['strips the fragment', 'https://example.com/page#section-2', 'https://example.com/page'],
    [
      'strips a bare trailing slash on the root path',
      'https://example.com/',
      'https://example.com',
    ],
    ['a bare origin with no path stays as-is', 'https://example.com', 'https://example.com'],
    [
      'preserves a legitimately repeated query key',
      'https://example.com/search?tag=a&tag=b',
      'https://example.com/search?tag=a&tag=b',
    ],
    [
      'a shortener host with no resolver available is left as its (host-normalized) self',
      'https://bit.ly/abc123',
      'https://bit.ly/abc123',
    ],
  ]

  it.each(cases)('%s', (_label, input, expected) => {
    expect(canonicalizeUrlSync(input)).toBe(expected)
  })

  it('is not thrown off by an unparseable URL — returns the trimmed input', () => {
    expect(canonicalizeUrlSync('not-a-valid-url')).toBe('not-a-valid-url')
    expect(canonicalizeUrlSync('  not-a-valid-url  ')).toBe('not-a-valid-url')
  })
})

describe('canonicalizeUrl (async — shortener resolution)', () => {
  it('resolves a known shortener and canonicalizes the destination', async () => {
    const resolveShortener = vi.fn(
      async () => 'https://example.com/real-article?utm_source=newsletter&id=9',
    )
    const result = await canonicalizeUrl('https://bit.ly/abc123', { resolveShortener })
    expect(result).toBe('https://example.com/real-article?id=9')
    expect(resolveShortener).toHaveBeenCalledWith('https://bit.ly/abc123')
  })

  it('falls back to the short link when the resolver returns null', async () => {
    const result = await canonicalizeUrl('https://bit.ly/xyz', {
      resolveShortener: async () => null,
    })
    expect(result).toBe('https://bit.ly/xyz')
  })

  it('falls back to the short link when the resolver throws — never rejects', async () => {
    const result = await canonicalizeUrl('https://bit.ly/broken', {
      resolveShortener: async () => {
        throw new Error('DNS lookup failed')
      },
    })
    expect(result).toBe('https://bit.ly/broken')
  })

  it('never calls the resolver for a non-shortener host', async () => {
    const resolveShortener = vi.fn(async () => 'https://should-not-be-used.example.com')
    const result = await canonicalizeUrl('https://example.com/foo?utm_source=x', {
      resolveShortener,
    })
    expect(result).toBe('https://example.com/foo')
    expect(resolveShortener).not.toHaveBeenCalled()
  })

  it('without a resolver at all, behaves exactly like the sync form', async () => {
    const result = await canonicalizeUrl('https://bit.ly/abc123')
    expect(result).toBe(canonicalizeUrlSync('https://bit.ly/abc123'))
  })
})

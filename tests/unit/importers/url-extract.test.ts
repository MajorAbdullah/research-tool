import { describe, expect, it } from 'vitest'
import { extractUrls } from '../../../src/lib/importers/url-extract'

describe('extractUrls', () => {
  it('returns an empty array when there is no URL', () => {
    expect(extractUrls('just chatting, no links here')).toEqual([])
  })

  it('extracts a single URL', () => {
    expect(extractUrls('check this out https://example.com/page')).toEqual([
      'https://example.com/page',
    ])
  })

  it('extracts multiple URLs from one message, in order', () => {
    const text = 'repo https://github.com/a/b and also https://example.com/x'
    expect(extractUrls(text)).toEqual(['https://github.com/a/b', 'https://example.com/x'])
  })

  it('prefixes a bare www. link with https://', () => {
    expect(extractUrls('see www.example.com/page for details')).toEqual([
      'https://www.example.com/page',
    ])
  })

  it('trims a trailing period', () => {
    expect(extractUrls('link: https://example.com/page.')).toEqual(['https://example.com/page'])
  })

  it('trims a trailing comma, exclamation and question mark', () => {
    expect(extractUrls('a https://example.com/1, b https://example.com/2! c https://example.com/3?')).toEqual([
      'https://example.com/1',
      'https://example.com/2',
      'https://example.com/3',
    ])
  })

  it('trims an unbalanced trailing closing parenthesis from prose wrapping', () => {
    expect(extractUrls('(see https://example.com/via-friend)')).toEqual([
      'https://example.com/via-friend',
    ])
  })

  it('keeps a trailing closing parenthesis that is balanced within the URL itself', () => {
    expect(
      extractUrls('see https://en.wikipedia.org/wiki/Bidirectional_text_(computing).'),
    ).toEqual(['https://en.wikipedia.org/wiki/Bidirectional_text_(computing)'])
  })

  it('extracts a URL from a multi-line message using the joined text', () => {
    const text = 'sharing a few things\nhttps://github.com/anthropics/claude-code\nenjoy'
    expect(extractUrls(text)).toEqual(['https://github.com/anthropics/claude-code'])
  })
})

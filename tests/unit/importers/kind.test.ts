import { describe, expect, it } from 'vitest'
import { classifyLinkKind } from '../../../src/lib/importers/kind'

describe('classifyLinkKind', () => {
  it('classifies github.com and gist.github.com as github', () => {
    expect(classifyLinkKind('https://github.com/anthropics/claude-code')).toBe('github')
    expect(classifyLinkKind('https://gist.github.com/user/abc123')).toBe('github')
  })

  it('classifies youtube/youtu.be/vimeo/tiktok as video', () => {
    expect(classifyLinkKind('https://www.youtube.com/watch?v=abc')).toBe('video')
    expect(classifyLinkKind('https://youtu.be/abc')).toBe('video')
    expect(classifyLinkKind('https://vimeo.com/123456')).toBe('video')
    expect(classifyLinkKind('https://www.tiktok.com/@user/video/123')).toBe('video')
  })

  it('classifies twitter/x/instagram/reddit as social', () => {
    expect(classifyLinkKind('https://twitter.com/user/status/123')).toBe('social')
    expect(classifyLinkKind('https://x.com/user/status/123')).toBe('social')
    expect(classifyLinkKind('https://www.instagram.com/reel/abc')).toBe('social')
    expect(classifyLinkKind('https://www.reddit.com/r/programming')).toBe('social')
  })

  it('classifies arxiv.org and any .pdf path as pdf', () => {
    expect(classifyLinkKind('https://arxiv.org/abs/2609.01234')).toBe('pdf')
    expect(classifyLinkKind('https://example.com/papers/report.pdf')).toBe('pdf')
  })

  it('classifies an ordinary web page as article', () => {
    expect(classifyLinkKind('https://example.com/blog/post')).toBe('article')
    expect(classifyLinkKind('https://news.ycombinator.com/item?id=1')).toBe('article')
  })

  it('classifies a non-http(s) scheme as other', () => {
    expect(classifyLinkKind('mailto:someone@example.com')).toBe('other')
  })

  it('classifies an unparseable URL as other rather than throwing', () => {
    expect(classifyLinkKind('not a url at all')).toBe('other')
  })
})

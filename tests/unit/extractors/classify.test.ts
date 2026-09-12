import { describe, expect, it } from 'vitest'
import { ItemKind } from '@/types/contracts'
import { classifyKind } from '@/lib/extractors/classify'

describe('classifyKind', () => {
  const cases: Array<[label: string, url: string, expected: ItemKind]> = [
    ['a plain GitHub repo URL', 'https://github.com/torvalds/linux', ItemKind.Github],
    [
      'a GitHub repo URL with a deep sub-path',
      'https://github.com/facebook/react/blob/main/README.md',
      ItemKind.Github,
    ],
    ['a youtube.com/watch URL', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', ItemKind.Video],
    ['a youtu.be short URL', 'https://youtu.be/dQw4w9WgXcQ', ItemKind.Video],
    ['a m.youtube.com URL', 'https://m.youtube.com/watch?v=abc123', ItemKind.Video],
    ['an Instagram reel URL', 'https://www.instagram.com/reel/Cabc123XYZ/', ItemKind.Social],
    ['an x.com status URL', 'https://x.com/user/status/12345', ItemKind.Social],
    [
      'a twitter.com status URL (aliases to x.com)',
      'https://twitter.com/user/status/12345',
      ItemKind.Social,
    ],
    ['a threads.net post URL', 'https://www.threads.net/@user/post/Cxyz123', ItemKind.Social],
    ['an arXiv abstract URL', 'https://arxiv.org/abs/1706.03762', ItemKind.Pdf],
    ['an arXiv direct-PDF URL', 'https://arxiv.org/pdf/1706.03762', ItemKind.Pdf],
    [
      'a direct .pdf URL on an arbitrary host',
      'https://example.com/papers/report.pdf',
      ItemKind.Pdf,
    ],
    [
      'a .pdf URL is matched case-insensitively',
      'https://example.com/papers/REPORT.PDF',
      ItemKind.Pdf,
    ],
    ['a SoundCloud URL', 'https://soundcloud.com/artist/track', ItemKind.Audio],
    ['a direct .mp3 URL', 'https://example.com/podcast/episode-1.mp3', ItemKind.Audio],
    ['a Spotify episode URL', 'https://open.spotify.com/episode/abc123', ItemKind.Audio],
    ['an ordinary blog post URL', 'https://example-blog.test/posts/why-we-moved', ItemKind.Article],
    ['a bare http origin with no path', 'http://example.com/', ItemKind.Article],
    ['a non-http(s) scheme URL', 'mailto:someone@example.com', ItemKind.Other],
    ['an unparseable, non-URL string', 'not a url at all', ItemKind.Other],
  ]

  it.each(cases)('%s -> %s', (_label, url, expected) => {
    expect(classifyKind(url)).toBe(expected)
  })

  it('covers all six non-other ItemKind values across the fixtures above', () => {
    const kindsCovered = new Set(cases.map(([, url]) => classifyKind(url)))
    for (const kind of [
      ItemKind.Github,
      ItemKind.Video,
      ItemKind.Article,
      ItemKind.Social,
      ItemKind.Pdf,
      ItemKind.Audio,
    ]) {
      expect(kindsCovered.has(kind)).toBe(true)
    }
  })
})

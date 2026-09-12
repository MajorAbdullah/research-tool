/**
 * YouTube — the extraction ladder (ADR 0006):
 *
 *   1. `full`    — `hint.transcript`, captured client-side by the extension's transcript-panel
 *                  scraper (P4.2.2), on the user's residential IP. oEmbed is still attempted
 *                  alongside it for title/author/thumbnail, but is best-effort: it never affects
 *                  this rung's tier or its success.
 *   2. `partial` — no client transcript. Try oEmbed (metadata) and the `timedtext` endpoint
 *                  (auto-captions) concurrently. `timedtext` is exactly the endpoint ADR 0006
 *                  documents as blockable from a datacenter IP — it may 429, and that must yield
 *                  `partial`, never an exception. Both a successful server-scraped transcript and
 *                  an oEmbed-only result (transcript blocked, metadata not) land here: neither is
 *                  as trustworthy as a human-captured transcript, but both beat a bare URL.
 *   3. `metadata_only` — both of rung 2's calls failed. All that's left is what's derivable from
 *                  the video id alone (a deterministic thumbnail URL) — no network, can't fail.
 */
import { ExtractionTier, ItemKind } from '@/types/contracts'
import type { ClientCapture, Extractor, ExtractedContent } from '@/types/contracts'
import { canonicalizeUrlSync } from './canonicalize'
import { type HttpClient, createHttpClient } from './http'
import { type Rung, runLadder } from './ladder'
import { capText } from './text'

const OEMBED_ENDPOINT = 'https://www.youtube.com/oembed'
const TIMEDTEXT_ENDPOINT = 'https://www.youtube.com/api/timedtext'
const OEMBED_TIMEOUT_MS = 6000
const TIMEDTEXT_TIMEOUT_MS = 6000

interface YoutubeOEmbedResponse {
  title?: string
  author_name?: string
  thumbnail_url?: string
}

interface TimedTextJson3 {
  events?: Array<{ segs?: Array<{ utf8?: string }> }>
}

export interface YoutubeExtractorDeps {
  http: HttpClient
}

export class YoutubeExtractor implements Extractor {
  readonly kind = ItemKind.Video
  private readonly http: HttpClient

  constructor(deps: Partial<YoutubeExtractorDeps> = {}) {
    this.http = deps.http ?? createHttpClient()
  }

  matches(url: string): boolean {
    return parseVideoId(url) !== null
  }

  async extract(url: string, hint?: ClientCapture): Promise<ExtractedContent> {
    const videoId = parseVideoId(url)
    if (!videoId) {
      throw new Error(`YoutubeExtractor.extract called with a non-YouTube URL: ${url}`)
    }

    const rungs: Rung[] = [
      {
        tier: ExtractionTier.Full,
        name: 'client-transcript',
        run: async () => {
          const transcript = hint?.transcript?.trim()
          if (!transcript) return null
          const meta = await fetchOEmbed(this.http, videoId).catch(() => null)
          return {
            contentText: capText(transcript),
            title: meta?.title,
            author: meta?.author_name,
            thumbnailUrl: meta?.thumbnail_url ?? guessThumbnail(videoId),
            kindFields: { videoId, transcriptSource: 'client_capture' },
            rawPayload: { oembed: meta },
          }
        },
      },
      {
        tier: ExtractionTier.Partial,
        name: 'server-oembed-and-timedtext',
        run: async () => {
          const [transcript, meta] = await Promise.all([
            fetchTimedText(this.http, videoId).catch(() => null),
            fetchOEmbed(this.http, videoId).catch(() => null),
          ])
          if (!transcript && !meta) return null // nothing at all — rung 3 handles it

          return {
            contentText: capText(transcript ?? meta?.title ?? `YouTube video ${videoId}`),
            title: meta?.title,
            author: meta?.author_name,
            thumbnailUrl: meta?.thumbnail_url ?? guessThumbnail(videoId),
            kindFields: { videoId, transcriptSource: transcript ? 'server_timedtext' : 'none' },
            rawPayload: { oembed: meta, hasTimedText: Boolean(transcript) },
          }
        },
      },
      {
        tier: ExtractionTier.MetadataOnly,
        name: 'video-id-only',
        run: async () => ({
          contentText: `YouTube video ${videoId}`,
          thumbnailUrl: guessThumbnail(videoId),
          kindFields: { videoId, transcriptSource: 'none' },
        }),
      },
    ]

    return runLadder(rungs)
  }
}

async function fetchOEmbed(http: HttpClient, videoId: string): Promise<YoutubeOEmbedResponse | null> {
  const watchUrl = encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)
  const res = await http.request(`${OEMBED_ENDPOINT}?url=${watchUrl}&format=json`, {
    timeoutMs: OEMBED_TIMEOUT_MS,
  })
  if (!res.ok) return null
  return JSON.parse(res.body.toString('utf-8')) as YoutubeOEmbedResponse
}

async function fetchTimedText(http: HttpClient, videoId: string): Promise<string | null> {
  const res = await http.request(`${TIMEDTEXT_ENDPOINT}?lang=en&v=${videoId}&fmt=json3`, {
    timeoutMs: TIMEDTEXT_TIMEOUT_MS,
  })
  if (!res.ok) return null

  const raw = res.body.toString('utf-8')
  if (!raw) return null

  let parsed: TimedTextJson3
  try {
    parsed = JSON.parse(raw) as TimedTextJson3
  } catch {
    return null
  }

  const text = (parsed.events ?? [])
    .flatMap((event) => event.segs ?? [])
    .map((seg) => seg.utf8 ?? '')
    .join('')
    .replace(/\n+/g, ' ')
    .trim()

  return text.length > 0 ? text : null
}

function guessThumbnail(videoId: string): string {
  // Deterministic from the video id — YouTube's thumbnail CDN path, no request required, so
  // rung 3 can supply it without any I/O that could itself fail.
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

function parseVideoId(url: string): string | null {
  let parsed: URL
  try {
    // canonicalizeUrlSync already rewrites youtu.be/<id> to youtube.com/watch?v=<id>, so this one
    // check covers both original forms.
    parsed = new URL(canonicalizeUrlSync(url))
  } catch {
    return null
  }
  if (parsed.hostname !== 'youtube.com') return null

  if (parsed.pathname === '/watch') {
    return parsed.searchParams.get('v')
  }
  const shortsMatch = /^\/shorts\/([\w-]{6,})/.exec(parsed.pathname)
  return shortsMatch?.[1] ?? null
}

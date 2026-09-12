/**
 * Instagram — the extraction ladder (ADR 0006):
 *
 *   1. `full`          — `hint.caption`, captured from the Android share-sheet payload (URL +
 *                        caption text, no extension involved — see ADR 0006's "Consequences").
 *   2. `partial`       — no caption. oEmbed metadata only (title/author/thumbnail, no caption
 *                        text) — real signal, but not the post itself.
 *   3. `metadata_only` — oEmbed also failed (Instagram's oEmbed has required an app access token
 *                        since 2020, so this is the common case, not the rare one). All Sieve has
 *                        is the URL — `kindFields.needsNote` flags that the UI should prompt the
 *                        user to add a note, since nothing else describes this item.
 */
import { ExtractionTier, ItemKind } from '@/types/contracts'
import type { ClientCapture, Extractor, ExtractedContent } from '@/types/contracts'
import { canonicalizeUrlSync } from './canonicalize'
import { type HttpClient, createHttpClient } from './http'
import { type Rung, runLadder } from './ladder'
import { capText } from './text'

const OEMBED_ENDPOINT = 'https://api.instagram.com/oembed'
const OEMBED_TIMEOUT_MS = 6000

interface InstagramOEmbedResponse {
  title?: string
  author_name?: string
  thumbnail_url?: string
}

export interface InstagramExtractorDeps {
  http: HttpClient
}

export class InstagramExtractor implements Extractor {
  readonly kind = ItemKind.Social
  private readonly http: HttpClient

  constructor(deps: Partial<InstagramExtractorDeps> = {}) {
    this.http = deps.http ?? createHttpClient()
  }

  matches(url: string): boolean {
    try {
      return new URL(canonicalizeUrlSync(url)).hostname === 'instagram.com'
    } catch {
      return false
    }
  }

  async extract(url: string, hint?: ClientCapture): Promise<ExtractedContent> {
    const rungs: Rung[] = [
      {
        tier: ExtractionTier.Full,
        name: 'share-sheet-caption',
        run: async () => {
          const caption = hint?.caption?.trim()
          if (!caption) return null
          const meta = await fetchOEmbed(this.http, url).catch(() => null)
          return {
            contentText: capText(caption),
            title: meta?.title,
            author: meta?.author_name,
            thumbnailUrl: meta?.thumbnail_url,
            kindFields: { source: 'share_sheet_caption', needsNote: false },
            rawPayload: { oembed: meta },
          }
        },
      },
      {
        tier: ExtractionTier.Partial,
        name: 'oembed-metadata',
        run: async () => {
          const meta = await fetchOEmbed(this.http, url)
          if (!meta) return null
          return {
            contentText: capText(meta.title ?? meta.author_name ?? url),
            title: meta.title,
            author: meta.author_name,
            thumbnailUrl: meta.thumbnail_url,
            kindFields: { source: 'oembed', needsNote: false },
            rawPayload: { oembed: meta },
          }
        },
      },
      {
        tier: ExtractionTier.MetadataOnly,
        name: 'url-only',
        run: async () => ({
          contentText: `Instagram post — no caption captured: ${url}`,
          kindFields: { source: 'none', needsNote: true },
        }),
      },
    ]

    return runLadder(rungs)
  }
}

async function fetchOEmbed(http: HttpClient, url: string): Promise<InstagramOEmbedResponse | null> {
  const res = await http.request(`${OEMBED_ENDPOINT}?url=${encodeURIComponent(url)}`, {
    timeoutMs: OEMBED_TIMEOUT_MS,
  })
  if (!res.ok) return null
  return JSON.parse(res.body.toString('utf-8')) as InstagramOEmbedResponse
}

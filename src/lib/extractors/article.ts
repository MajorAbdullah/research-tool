/**
 * Article / blog — the extraction ladder in its purest form (ADR 0006):
 *
 *   1. `full`          — Readability over the extension's captured DOM (`hint.html`).
 *   2. `full`          — Readability over a server-side fetch of the URL. Same extraction
 *                        *method* as rung 1 (Readability), just a different, less reliable HTML
 *                        source — a Cloudflare-fronted site can return a challenge page here.
 *   3. `metadata_only` — OG/meta tags from whatever HTML rung 1 or 2 produced, even if Readability
 *                        couldn't find "an article" in it (this is what makes a Cloudflare
 *                        challenge page degrade to a truthful metadata_only instead of nothing);
 *                        or, if there is no HTML at all (total network failure), a title guessed
 *                        from the URL's last path segment.
 *
 * Rung 3 never does I/O and never throws, so this extractor never rejects — see ladder.ts.
 *
 * Security: `new JSDOM(html)` is called with no `runScripts`/`resources` options, which are
 * jsdom's safe defaults — scripts in captured/fetched HTML are never executed and no external
 * resource is ever fetched. Do not add either option; see CLAUDE.md, untrusted-input handling.
 */
import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import { ExtractionTier, ItemKind } from '@/types/contracts'
import type { ClientCapture, Extractor, ExtractedContent } from '@/types/contracts'
import { canonicalizeUrlSync } from './canonicalize'
import { type HttpClient, createHttpClient } from './http'
import { type Rung, runLadder } from './ladder'
import { capText } from './text'

// A real article body is comfortably 4 figures of characters (our own fixtures run ~1500-2000).
// A Cloudflare/bot-check interstitial's actual text ("Checking if the site connection is
// secure... Enable JavaScript and cookies to continue... Ray ID: ...") still measures a couple
// hundred characters — real, but not an article — so the threshold needs enough headroom to
// separate the two, not just to rule out an empty/near-empty page.
const MIN_ARTICLE_CHARS = 400
const SERVER_FETCH_TIMEOUT_MS = 10_000
const BROWSER_LIKE_HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/128.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}

export interface ArticleExtractorDeps {
  http: HttpClient
}

export class ArticleExtractor implements Extractor {
  readonly kind = ItemKind.Article
  private readonly http: HttpClient

  constructor(deps: Partial<ArticleExtractorDeps> = {}) {
    this.http = deps.http ?? createHttpClient()
  }

  matches(url: string): boolean {
    try {
      const parsed = new URL(canonicalizeUrlSync(url))
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
  }

  async extract(url: string, hint?: ClientCapture): Promise<ExtractedContent> {
    // Populated by rung 2 if a server fetch returns any bytes at all, even on a non-2xx status —
    // rung 3 needs that HTML too (a Cloudflare challenge page still has a real <title>).
    let serverHtml: string | undefined

    const rungs: Rung[] = [
      {
        tier: ExtractionTier.Full,
        name: 'client-html-readability',
        run: async () => {
          if (!hint?.html) return null
          return extractWithReadability(hint.html, url)
        },
      },
      {
        tier: ExtractionTier.Full,
        name: 'server-fetch-readability',
        run: async () => {
          let res
          try {
            res = await this.http.request(url, {
              headers: BROWSER_LIKE_HEADERS,
              timeoutMs: SERVER_FETCH_TIMEOUT_MS,
            })
          } catch {
            return null // total network failure — nothing for rung 3 to read either
          }
          serverHtml = res.body.toString('utf-8') || undefined
          if (!res.ok || !serverHtml) return null
          return extractWithReadability(serverHtml, url)
        },
      },
      {
        tier: ExtractionTier.MetadataOnly,
        name: 'meta-tags-or-url-only',
        run: async () => {
          const html = hint?.html ?? serverHtml
          return html ? extractMetaTagsOnly(html, url) : fallbackFromUrlOnly(url)
        },
      },
    ]

    return runLadder(rungs)
  }
}

function extractWithReadability(
  html: string,
  url: string,
): Omit<ExtractedContent, 'extractionTier'> | null {
  const dom = new JSDOM(html, { url })
  const reader = new Readability(dom.window.document)
  const article = reader.parse()
  if (!article) return null

  const textContent = article.textContent?.trim()
  if (!textContent || textContent.length < MIN_ARTICLE_CHARS) return null

  const publishedAtMs = article.publishedTime ? Date.parse(article.publishedTime) : NaN

  return {
    contentText: capText(textContent),
    title: article.title ?? undefined,
    author: article.byline ?? undefined,
    publishedAt: Number.isNaN(publishedAtMs) ? undefined : publishedAtMs,
    rawPayload: { excerpt: article.excerpt, siteName: article.siteName },
  }
}

function extractMetaTagsOnly(html: string, url: string): Omit<ExtractedContent, 'extractionTier'> {
  const dom = new JSDOM(html, { url })
  const doc = dom.window.document
  const og = (property: string): string | undefined =>
    doc.querySelector(`meta[property="og:${property}"]`)?.getAttribute('content')?.trim() ||
    undefined
  const metaName = (name: string): string | undefined =>
    doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() || undefined

  const title = og('title') ?? doc.querySelector('title')?.textContent?.trim() ?? undefined
  const description = og('description') ?? metaName('description')
  const author = metaName('author')
  const publishedRaw = doc
    .querySelector('meta[property="article:published_time"]')
    ?.getAttribute('content')
  const publishedAtMs = publishedRaw ? Date.parse(publishedRaw) : NaN

  return {
    contentText: capText(description ?? title ?? url),
    title,
    author,
    publishedAt: Number.isNaN(publishedAtMs) ? undefined : publishedAtMs,
    thumbnailUrl: og('image'),
    rawPayload: { ogTitle: title ?? null, ogDescription: description ?? null },
  }
}

function fallbackFromUrlOnly(url: string): Omit<ExtractedContent, 'extractionTier'> {
  const title = titleFromUrl(url)
  return {
    contentText: title ? `${title} — ${url}` : url,
    title,
  }
}

function titleFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop()
    if (!lastSegment) return undefined
    const humanized = lastSegment
      .replace(/\.\w+$/, '')
      .replace(/[-_]+/g, ' ')
      .trim()
    return humanized || undefined
  } catch {
    return undefined
  }
}

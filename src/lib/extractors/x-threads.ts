/**
 * X / Threads — the extraction ladder (ADR 0006):
 *
 *   1. `full`          — over the extension's captured DOM (`hint.html`). For x.com/twitter.com,
 *                        `hint.html` is NOT a raw page: the extension's own thread walker
 *                        (`extension/src/content/x-thread.ts`, verified live against x.com on
 *                        2026-09-12) already selects only real posts (an `<article>` with a
 *                        `/status/<id>` permalink — `data-testid` attributes like `"tweet"` /
 *                        `"tweetText"` / `"User-Name"` were confirmed **absent site-wide**, so
 *                        don't resurrect them here), already dedupes repeats, and already orders
 *                        them into conversation order by numeric Snowflake id rather than DOM
 *                        order — then sends that pre-ordered, pre-filtered set of `<article>`
 *                        outerHTML fragments. This function's only remaining job is turning each
 *                        article's HTML into clean text and preserving the order it arrived in.
 *                        Threads doesn't have an equivalent specialized walker yet (P4 only wires
 *                        `isXOrThreadsPage()` to x.com/twitter.com hostnames today — a threads.net
 *                        capture currently falls through to the extension's generic whole-page DOM
 *                        capture instead), so a Threads `hint.html` may not contain `<article>`
 *                        elements at all; when it doesn't, `postNodes.length === 0` and this rung
 *                        correctly falls through to rung 2 rather than fabricating a result.
 *   2. `partial`       — no usable client capture. A server-side fetch for OG tags only (X/Threads
 *                        aggressively rate-limit non-browser traffic, so this is expected to fail
 *                        often — see ADR 0006).
 *   3. `metadata_only` — total failure. URL only, no I/O, can't fail.
 *
 * Security: see article.ts's note on JSDOM — no `runScripts`, no `resources`, same here.
 */
import { JSDOM } from 'jsdom'
import { ExtractionTier, ItemKind } from '@/types/contracts'
import type { ClientCapture, Extractor, ExtractedContent } from '@/types/contracts'
import { canonicalizeUrlSync } from './canonicalize'
import { type HttpClient, createHttpClient } from './http'
import { type Rung, runLadder } from './ladder'
import { capText } from './text'

const THREAD_HOSTS = new Set(['x.com', 'threads.net', 'threads.com'])
const POST_SEPARATOR = '\n\n---\n\n'
const SERVER_FETCH_TIMEOUT_MS = 8000
/** Matches `extension/src/content/x-thread.ts`'s verified-live selector — see module comment. */
const POST_SELECTOR = 'article'
const STATUS_PERMALINK_PATTERN = /^\/([^/]+)\/status\/\d+/

export interface XThreadsExtractorDeps {
  http: HttpClient
}

export class XThreadsExtractor implements Extractor {
  readonly kind = ItemKind.Social
  private readonly http: HttpClient

  constructor(deps: Partial<XThreadsExtractorDeps> = {}) {
    this.http = deps.http ?? createHttpClient()
  }

  matches(url: string): boolean {
    try {
      return THREAD_HOSTS.has(new URL(canonicalizeUrlSync(url)).hostname)
    } catch {
      return false
    }
  }

  async extract(url: string, hint?: ClientCapture): Promise<ExtractedContent> {
    const rungs: Rung[] = [
      {
        tier: ExtractionTier.Full,
        name: 'client-dom-thread-walk',
        run: async () => {
          if (!hint?.html) return null
          return walkThread(hint.html, url)
        },
      },
      {
        tier: ExtractionTier.Partial,
        name: 'server-og-tags',
        run: async () => {
          let html: string | undefined
          try {
            const res = await this.http.request(url, { timeoutMs: SERVER_FETCH_TIMEOUT_MS })
            html = res.body.toString('utf-8') || undefined
          } catch {
            return null
          }
          return html ? extractOgTags(html, url) : null
        },
      },
      {
        tier: ExtractionTier.MetadataOnly,
        name: 'url-only',
        run: async () => ({ contentText: url }),
      },
    ]

    return runLadder(rungs)
  }
}

function walkThread(html: string, url: string): Omit<ExtractedContent, 'extractionTier'> | null {
  const dom = new JSDOM(html, { url })
  const doc = dom.window.document
  const articles = Array.from(doc.querySelectorAll(POST_SELECTOR))
  if (articles.length === 0) return null

  const posts = articles
    .map((node) => node.textContent?.trim() ?? '')
    .filter((text) => text.length > 0)
  if (posts.length === 0) return null

  // The permalink (`/<handle>/status/<id>`) is the one durable anchor the extension's own walker
  // depends on too — reuse it here to pull the author handle rather than a chrome-dependent
  // selector.
  const firstPermalinkHref =
    articles[0]?.querySelector('a[href*="/status/"]')?.getAttribute('href') ?? ''
  const authorHandle = STATUS_PERMALINK_PATTERN.exec(firstPermalinkHref)?.[1]

  return {
    contentText: capText(posts.join(POST_SEPARATOR)),
    author: authorHandle,
    kindFields: { postCount: posts.length },
  }
}

function extractOgTags(html: string, url: string): Omit<ExtractedContent, 'extractionTier'> | null {
  const dom = new JSDOM(html, { url })
  const doc = dom.window.document
  const og = (property: string): string | undefined =>
    doc.querySelector(`meta[property="og:${property}"]`)?.getAttribute('content')?.trim() ||
    undefined

  const title = og('title') ?? doc.querySelector('title')?.textContent?.trim() ?? undefined
  const description = og('description')
  if (!title && !description) return null

  return {
    contentText: capText(description ?? title ?? url),
    title,
    thumbnailUrl: og('image'),
  }
}

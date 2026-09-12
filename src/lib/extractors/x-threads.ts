/**
 * X / Threads — the extraction ladder (ADR 0006):
 *
 *   1. `full`          — a "thread walker" over the extension's captured DOM (`hint.html`):
 *                        finds each post element in document order (the order they render in,
 *                        which is thread/reply order) and concatenates their text, preserving
 *                        that order.
 *   2. `partial`       — no client capture. A server-side fetch for OG tags only (X/Threads
 *                        aggressively rate-limit non-browser traffic, so this is expected to fail
 *                        often — see ADR 0006).
 *   3. `metadata_only` — total failure. URL only, no I/O, can't fail.
 *
 * The DOM selectors below target X's current web markup (`data-testid="tweet"` /
 * `"tweetText"` / `"User-Name"`). Threads' equivalent markup hasn't been finalized against a real
 * capture yet (P4 builds the extension's actual DOM capture); once it has, add its selectors
 * alongside X's rather than replacing them; the acceptance criterion covered here (P2 spec: "8-post
 * thread concatenated in order") is exercised against X markup.
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
const POST_SELECTOR = '[data-testid="tweet"], [data-sieve-post]'

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
  const postNodes = Array.from(doc.querySelectorAll(POST_SELECTOR))
  if (postNodes.length === 0) return null

  const posts = postNodes
    .map((node) => {
      const textNode = node.querySelector('[data-testid="tweetText"]') ?? node
      return textNode.textContent?.trim() ?? ''
    })
    .filter((text) => text.length > 0)
  if (posts.length === 0) return null

  const authorHref = doc.querySelector('[data-testid="User-Name"] a[href^="/"]')?.getAttribute('href')
  const authorHandle = authorHref?.startsWith('/') ? authorHref.slice(1) : undefined

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
    doc.querySelector(`meta[property="og:${property}"]`)?.getAttribute('content')?.trim() || undefined

  const title = og('title') ?? doc.querySelector('title')?.textContent?.trim() ?? undefined
  const description = og('description')
  if (!title && !description) return null

  return {
    contentText: capText(description ?? title ?? url),
    title,
    thumbnailUrl: og('image'),
  }
}

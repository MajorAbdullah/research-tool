/**
 * X/Threads thread walker (P4.2.3): collects every post in the currently
 * open thread and returns their real DOM markup, re-ordered into
 * conversation order (see x-thread-order.ts for why sorting matters and why
 * it sorts by status ID rather than trusting DOM order).
 *
 * ============================================================================
 * DOM ASSUMPTIONS — verified LIVE against x.com on 2026-09-12
 * ============================================================================
 * Loaded https://x.com/OpenAI (a profile timeline — a specific thread URL
 * wasn't available to verify against in this session, see the README's
 * "Contract ambiguities / what wasn't live-verified" section) and inspected
 * the live DOM. Findings that matter for this file:
 *
 *  - `data-testid` IS GONE. Every historical write-up / gist about scraping
 *    Twitter/X assumes `article[data-testid="tweet"]`,
 *    `[data-testid="tweetText"]`, `[data-testid="User-Name"]`, etc. As of
 *    this date, **zero** elements anywhere on a loaded x.com page carry a
 *    `data-testid` attribute at all. Do not resurrect those selectors
 *    without re-checking first — they were confirmed absent, not just
 *    unused.
 *  - Each post is still a plain `<article>` element (5 on the profile page
 *    checked). No `role="article"`, no `aria-labelledby` on it either
 *    (another pattern the old React-era Twitter app used and this one does
 *    not).
 *  - Every post's permalink — `a[href*="/status/<numeric id>"]` — IS still
 *    present and reliable. This is what `extractPostId` below depends on,
 *    and it's the more durable anchor anyway (see x-thread-order.ts: the
 *    numeric ID also gives us chronological ordering for free).
 *  - No `<time>` element was found in the one article inspected in depth —
 *    so don't depend on `article time[datetime]` for anything.
 *  - Post text lived in a `<span class="font-chirp ...">` ("Chirp" is X's
 *    real, branded in-house typeface, so this is at least a
 *    company-specific hook rather than an arbitrary utility class — but it
 *    is still a class name, the least stable kind of selector, and is
 *    NOT used as a hard dependency below: this file keeps each whole
 *    `<article>`'s outerHTML rather than trying to extract just the text
 *    span, specifically so a class rename here doesn't break capture, only
 *    (at worst) makes the server's downstream HTML-to-text step see a bit
 *    more chrome around the actual text).
 *
 * IF THIS BREAKS: open any status URL on x.com/twitter.com, inspect one
 * `<article>` in devtools, and confirm `a[href*="/status/"]` is still inside
 * it. That single selector is the only hard dependency in this file.
 */

import { orderThreadPosts } from './x-thread-order'

interface ExtractedPost {
  id: string
  element: Element
}

const STATUS_ID_PATTERN = /\/status\/(\d+)/

function extractPostId(article: Element): string | null {
  const permalink = article.querySelector('a[href*="/status/"]')
  const href = permalink?.getAttribute('href') ?? ''
  const match = STATUS_ID_PATTERN.exec(href)
  return match?.[1] ?? null
}

function extractPosts(root: ParentNode): ExtractedPost[] {
  const posts: ExtractedPost[] = []
  for (const article of Array.from(root.querySelectorAll('article'))) {
    const id = extractPostId(article)
    if (id) posts.push({ id, element: article })
  }
  return posts
}

/**
 * Returns the thread's posts concatenated as HTML, in conversation order —
 * this is what lands in `CaptureRequest.html` for an X/Threads capture (the
 * field docs/API.md documents as "client-captured post-render outerHTML
 * (article/X/Threads)"). Returns `null` if no posts were found at all, so
 * the caller can fall back to a generic whole-page capture instead of
 * sending an empty string.
 */
export function walkXThread(root: ParentNode = document): string | null {
  const posts = extractPosts(root)
  if (posts.length === 0) return null

  return orderThreadPosts(posts)
    .map((post) => post.element.outerHTML)
    .join('\n')
}

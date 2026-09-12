/**
 * Instagram Reel caption + author grab from an open post (P4.2.4).
 *
 * ============================================================================
 * NOT live-verified this session
 * ============================================================================
 * youtube.com and x.com were reachable and inspected live from this sandbox
 * (see youtube-transcript-assemble.ts and x-thread.ts for what that turned
 * up); instagram.com was not attempted, because most Reel content requires a
 * logged-in session to render at all, which isn't something a one-off
 * automated check can exercise meaningfully. Treat everything below as
 * best-effort, not verified fact — consistent with docs/adr/0006 and the
 * plan's own risk register, both of which already expect Instagram
 * extraction to stay weak and degrade to `metadata_only` server-side
 * sometimes. That's an accepted, UI-surfaced limitation, not a bug in this
 * file.
 *
 * Strategy, in priority order:
 *  1. `<meta property="og:description">` — Instagram has long populated this
 *     with the post's caption text, because their OWN link-preview
 *     generation (Slack unfurls, iMessage previews, etc.) depends on it
 *     working for crawlers that never log in either. This is the most
 *     durable option specifically because Instagram has an external
 *     incentive to keep it accurate, independent of whatever their logged-in
 *     web app's DOM looks like.
 *  2. `<meta property="og:title">`, historically formatted as
 *     `"<author> on Instagram"` — used only to recover the author handle.
 *  3. A best-effort DOM read of the caption near the post (a bare fallback
 *     for when the meta tags are missing/empty), which is exactly the kind
 *     of unverified, likely-to-rot selector this file's own doc comment is
 *     warning about — expect this branch specifically to need attention
 *     first if Instagram capture stops working.
 *
 * IF THIS BREAKS: open a Reel you're logged into, view source / inspect
 * `<head>` for the `og:description`/`og:title` meta tags first (cheapest
 * thing to check, and most likely to still be fine even if the DOM fallback
 * below has rotted); only chase the DOM fallback if those are genuinely
 * empty.
 */

export interface InstagramCaptureResult {
  caption: string | null
  author: string | null
}

function metaContent(doc: Document, property: string): string | null {
  const value = doc.querySelector(`meta[property="${property}"]`)?.getAttribute('content')
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function extractAuthor(doc: Document): string | null {
  const ogTitle = metaContent(doc, 'og:title')
  // Historically formatted "<Author> on Instagram" or "<Author> on Instagram: ...".
  const match = ogTitle ? /^(.+?)\s+on Instagram\b/i.exec(ogTitle) : null
  if (match?.[1]) return match[1].trim()

  // Unverified DOM fallback — see file header.
  const domAuthor = doc.querySelector('header a[role="link"] span')?.textContent?.trim()
  return domAuthor && domAuthor.length > 0 ? domAuthor : null
}

function extractCaption(doc: Document): string | null {
  const ogDescription = metaContent(doc, 'og:description')
  if (ogDescription) return ogDescription

  // Unverified DOM fallback — see file header.
  const domCaption = doc.querySelector('article h1')?.textContent?.trim()
  return domCaption && domCaption.length > 0 ? domCaption : null
}

export function grabInstagramReel(doc: Document = document): InstagramCaptureResult {
  return { caption: extractCaption(doc), author: extractAuthor(doc) }
}

/**
 * docs/API.md's `CaptureRequest` has a single free-text `caption` field with
 * no separate author sub-field (see the README's "Contract ambiguities"
 * section) — so when we have both, the author is folded into the same
 * string rather than dropped. Pure and unit-tested alongside the rest of the
 * "assembly" logic since it takes plain data, not a DOM.
 */
export function formatCaptureCaption(result: InstagramCaptureResult): string | undefined {
  if (result.author && result.caption) return `${result.author}: ${result.caption}`
  if (result.caption) return result.caption
  if (result.author) return result.author
  return undefined
}

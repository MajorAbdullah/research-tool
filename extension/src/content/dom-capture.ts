/**
 * Generic post-render capture (P4.2.1) — the fallback used for anything that
 * isn't YouTube/X/Threads/Instagram: articles, blogs, Cloudflare-fronted
 * pages the server itself can't fetch, docs, etc.
 *
 * "Post-render" just means we read it at capture time (user-triggered, via
 * toolbar/shortcut/popup) rather than the server re-fetching the URL — by
 * the time the user invokes capture the page has already finished whatever
 * client-side rendering it was going to do. No extra wait is needed here the
 * way YouTube's transcript panel needs one, since we're not waiting on any
 * particular async widget to open.
 */
export function captureOuterHtml(doc: Document = document): string {
  return doc.documentElement.outerHTML
}

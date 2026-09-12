import { createHash } from 'node:crypto'

const TRACKING_PARAM_PREFIXES = ['utm_']
const TRACKING_PARAM_NAMES = new Set(['si', 'igshid', 'fbclid', 'gclid'])

/**
 * Local, best-effort URL canonicalization for import-time dedupe ONLY.
 *
 * TODO(P0-reconcile): the real canonicalizer (P2.1.1 — strips `utm_*`/`si`/`igshid`,
 * resolves shorteners, `youtu.be` -> `watch?v=`) is owned by the extractors phase and
 * isn't present in this tree. `WhatsAppImportService` accepts a `canonicalizeUrl`
 * override (see `service.ts`) specifically so it can be wired to the real one once
 * available — import-time dedupe should end up hashing the exact same canonical form
 * the rest of the app uses. Until then, this subset (host casing, default ports,
 * fragment, common tracking params, trailing slash) is enough to make "import the
 * same export twice" a no-op, which is the concrete requirement (P12.4).
 */
export function canonicalizeUrlForDedupe(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    u.hash = ''
    u.hostname = u.hostname.toLowerCase()
    if (
      (u.protocol === 'http:' && u.port === '80') ||
      (u.protocol === 'https:' && u.port === '443')
    ) {
      u.port = ''
    }
    const params = new URLSearchParams(u.search)
    for (const key of Array.from(params.keys())) {
      const lower = key.toLowerCase()
      if (
        TRACKING_PARAM_PREFIXES.some((p) => lower.startsWith(p)) ||
        TRACKING_PARAM_NAMES.has(lower)
      ) {
        params.delete(key)
      }
    }
    const query = params.toString()
    u.search = query ? `?${query}` : ''
    const serialized = u.toString()
    return u.pathname !== '/' && serialized.endsWith('/') ? serialized.slice(0, -1) : serialized
  } catch {
    return rawUrl.trim().toLowerCase()
  }
}

export type UrlCanonicalizer = (url: string) => string

/** `url_hash` — sha256 of the canonical URL, matching how the rest of the app dedupes items. */
export function computeUrlHash(
  rawUrl: string,
  canonicalize: UrlCanonicalizer = canonicalizeUrlForDedupe,
): string {
  return createHash('sha256').update(canonicalize(rawUrl)).digest('hex')
}

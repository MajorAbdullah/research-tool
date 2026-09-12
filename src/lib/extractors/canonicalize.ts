/**
 * URL canonicalization — the thing capture-time dedupe (`items.url_hash`, P1) hashes, and what
 * every extractor's `matches()`/kind classification runs against.
 *
 * Rules (in order applied): lowercase scheme + host, strip a leading "www." label, alias a couple
 * of hosts that are the same content under a different name (youtu.be/m.youtube.com -> youtube.com,
 * twitter.com -> x.com — the whole point of canonicalizing is that the same content dedupes the
 * same way regardless of which form was shared), rewrite youtu.be/<id> to a youtube.com/watch
 * URL, collapse any github.com sub-path to owner/repo, strip tracking params (utm_-prefixed, si,
 * igshid, fbclid, ref), strip the fragment, strip a trailing slash.
 *
 * Deliberately NOT done: reordering surviving query params. Only the params this spec names are
 * touched; anything else (a real `v`, `t`, `id`...) passes through untouched and in its original
 * order, so canonicalization can't quietly change a URL's meaning.
 */

const TRACKING_PARAM_PREFIXES = ['utm_']
const TRACKING_PARAM_EXACT = new Set(['si', 'igshid', 'fbclid', 'ref'])

/** Hosts that are the same content/service as their canonical form, just spelled differently. */
const HOST_ALIASES: Record<string, string> = {
  'm.youtube.com': 'youtube.com',
  'twitter.com': 'x.com',
}

const KNOWN_SHORTENER_HOSTS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'rebrand.ly',
  'amzn.to',
  'lnkd.in',
  'goo.gl',
])

function shouldStripParam(key: string): boolean {
  const lower = key.toLowerCase()
  if (TRACKING_PARAM_EXACT.has(lower)) return true
  return TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

function stripHostPrefix(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host
}

function filterParams(source: URLSearchParams): URLSearchParams {
  const filtered = new URLSearchParams()
  for (const [key, value] of source) {
    if (shouldStripParam(key)) continue
    // append, not set — a legitimately repeated key (?tag=a&tag=b) must survive canonicalization.
    filtered.append(key, value)
  }
  return filtered
}

/**
 * The synchronous core: everything except following a shortener's actual redirect (which needs
 * network access — see `canonicalizeUrl` below). Safe to call from anywhere, including hot paths
 * that must stay synchronous (classification, `matches()`).
 */
export function canonicalizeUrlSync(rawUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return rawUrl.trim()
  }

  const protocol = parsed.protocol.toLowerCase()
  let host = stripHostPrefix(parsed.hostname.toLowerCase())

  // youtu.be/<id>[?...] -> https://youtube.com/watch?v=<id>[&...]. Handled before generic alias
  // resolution since it rewrites the path, not just the host.
  if (host === 'youtu.be') {
    const id = parsed.pathname.split('/').filter(Boolean)[0] ?? ''
    // `v` goes first (it's the primary identifier) and is always path-derived — a stray `?v=`
    // on a youtu.be link would be malformed input, and the path wins regardless.
    const params = new URLSearchParams()
    params.set('v', id)
    for (const [key, value] of parsed.searchParams) {
      if (key === 'v' || shouldStripParam(key)) continue
      params.append(key, value)
    }
    return `https://youtube.com/watch?${params.toString()}`
  }

  host = HOST_ALIASES[host] ?? host

  if (host === 'github.com') {
    const segments = parsed.pathname.split('/').filter(Boolean)
    const owner = segments[0]
    const repo = segments[1]
    if (owner && repo) {
      return `https://github.com/${owner}/${repo.replace(/\.git$/, '')}`
    }
    // Fewer than two segments (e.g. github.com/torvalds alone) — nothing to collapse; fall
    // through to the generic path below.
  }

  const params = filterParams(parsed.searchParams)
  const query = params.toString()
  let path = parsed.pathname
  if (path.endsWith('/')) path = path.slice(0, -1)

  return `${protocol}//${host}${path}${query ? `?${query}` : ''}`
}

export interface CanonicalizeOptions {
  /**
   * Resolves a known shortener to its real destination (a HEAD request following redirects, in
   * production). Optional and injected deliberately: canonicalization must work without network
   * access, and a resolution failure must degrade to the shortener URL itself, never throw.
   */
  resolveShortener?: (url: string) => Promise<string | null>
}

/** Full canonicalization, including following a known shortener's redirect when possible. */
export async function canonicalizeUrl(rawUrl: string, options: CanonicalizeOptions = {}): Promise<string> {
  const syncForm = canonicalizeUrlSync(rawUrl)
  if (!options.resolveShortener) return syncForm

  let host: string
  try {
    host = new URL(syncForm).hostname
  } catch {
    return syncForm
  }
  if (!KNOWN_SHORTENER_HOSTS.has(host)) return syncForm

  try {
    const resolved = await options.resolveShortener(syncForm)
    return resolved ? canonicalizeUrlSync(resolved) : syncForm
  } catch {
    // A shortener that fails to resolve must never block capture — fall back to the short link.
    return syncForm
  }
}

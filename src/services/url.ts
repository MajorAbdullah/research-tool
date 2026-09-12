/**
 * URL handling for capture: is-it-http(s) validation, LOCAL canonicalization + hashing for
 * dedup, and a best-effort `kind` guess.
 *
 * Deliberately does no network I/O — `POST /api/v1/capture` must respond in under 300ms and
 * never do I/O to the target URL inline (docs/API.md §3.1). That means the "shorteners resolved"
 * part of `canonical_url`'s documented definition (docs/API.md §2: "normalized: utm_* / si /
 * igshid stripped, shorteners resolved") is NOT done here — following a redirect is a network
 * call. This module only strips known tracking parameters and normalizes formatting; resolving a
 * shortener (t.co, bit.ly, etc.) would need to happen in an async pipeline stage, which does not
 * exist yet (see this phase's final report).
 */

import { createHash } from 'node:crypto'
import { ItemKind } from '@/types/contracts'
import type { ItemKind as ItemKindType } from '@/types/contracts'

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Tracking params stripped regardless of source site — the standard analytics/attribution set
 * (utm_*, click ids) plus the two docs/API.md names explicitly by name (`si` — YouTube share,
 * `igshid` — Instagram share).
 */
const TRACKING_PARAM_PATTERNS: RegExp[] = [
  /^utm_/i,
  /^si$/i,
  /^igshid$/i,
  /^igsh$/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^msclkid$/i,
  /^ref$/i,
  /^ref_src$/i,
  /^ref_url$/i,
  /^spm$/i,
  /^s$/i, // X/Twitter share-sheet param
]

function isTrackingParam(name: string): boolean {
  return TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(name))
}

/**
 * Local (no-network) normalization: lowercase scheme/host, drop default ports, drop the
 * fragment, strip tracking params, sort remaining params for determinism, drop a trailing slash
 * on a non-root path. NOT a full canonicalization — see file header on shortener resolution.
 */
export function canonicalizeUrl(raw: string): string {
  const url = new URL(raw)
  url.protocol = url.protocol.toLowerCase()
  url.hostname = url.hostname.toLowerCase()
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = ''
  }
  url.hash = ''

  const keptParams = [...url.searchParams.entries()]
    .filter(([name]) => !isTrackingParam(name))
    .sort(([a], [b]) => a.localeCompare(b))
  url.search = ''
  for (const [name, value] of keptParams) {
    url.searchParams.append(name, value)
  }

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '')
  }

  return url.toString()
}

/** Stable dedup key for `items.url_hash` — sha256 of the locally-canonicalized URL. */
export function hashUrl(canonicalUrl: string): string {
  return createHash('sha256').update(canonicalUrl).digest('hex')
}

interface KindRule {
  test: (hostname: string, pathname: string) => boolean
  kind: ItemKindType
}

/**
 * Best-effort classification from the URL alone — capture runs before any content is fetched, so
 * this is necessarily a guess. The pipeline (out of this phase's scope) is free to correct `kind`
 * once it has actually looked at the content; nothing here is meant to be the final word.
 */
const KIND_RULES: KindRule[] = [
  { test: (h) => h === 'github.com' || h.endsWith('.github.com'), kind: ItemKind.Github },
  {
    test: (h) =>
      h === 'youtube.com' || h === 'www.youtube.com' || h === 'youtu.be' || h === 'm.youtube.com',
    kind: ItemKind.Video,
  },
  { test: (h) => h === 'vimeo.com' || h === 'www.vimeo.com', kind: ItemKind.Video },
  {
    test: (h) =>
      [
        'instagram.com',
        'www.instagram.com',
        'x.com',
        'www.x.com',
        'twitter.com',
        'www.twitter.com',
        'threads.net',
        'www.threads.net',
        'tiktok.com',
        'www.tiktok.com',
        'reddit.com',
        'www.reddit.com',
      ].includes(h),
    kind: ItemKind.Social,
  },
  {
    test: (h) =>
      ['open.spotify.com', 'soundcloud.com', 'www.soundcloud.com', 'podcasts.apple.com'].includes(
        h,
      ),
    kind: ItemKind.Audio,
  },
  { test: (_h, p) => p.toLowerCase().endsWith('.pdf'), kind: ItemKind.Pdf },
]

export function guessKind(canonicalUrl: string): ItemKindType {
  const url = new URL(canonicalUrl)
  const hostname = url.hostname.toLowerCase()
  const rule = KIND_RULES.find((r) => r.test(hostname, url.pathname))
  return rule?.kind ?? ItemKind.Article
}

import type { ImportLinkKind } from './types'

const GITHUB_HOSTS = ['github.com', 'gist.github.com']
const VIDEO_HOSTS = ['youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com']
const SOCIAL_HOSTS = [
  'twitter.com',
  'x.com',
  'instagram.com',
  'threads.net',
  'facebook.com',
  'linkedin.com',
  'reddit.com',
]
const PDF_HOSTS = ['arxiv.org']

function hostMatches(host: string, list: readonly string[]): boolean {
  return list.some((h) => host === h || host.endsWith(`.${h}`))
}

/**
 * Lightweight, host-based heuristic used ONLY for the import dry-run preview's
 * `by_kind` breakdown (docs/API.md §3.9.1). This is deliberately NOT the same
 * classifier as the real per-item kind classification (P2.1.2, which runs later
 * against the canonicalized URL once an item actually exists, and lives outside P12's
 * scope) — this one just needs to be good enough for an honest "what am I about to
 * import" preview before the user commits.
 */
export function classifyLinkKind(url: string): ImportLinkKind {
  let host: string
  let protocol: string
  let pathname: string
  try {
    const parsed = new URL(url)
    host = parsed.hostname.toLowerCase()
    protocol = parsed.protocol
    pathname = parsed.pathname
  } catch {
    return 'other'
  }
  if (protocol !== 'http:' && protocol !== 'https:') return 'other'
  if (hostMatches(host, GITHUB_HOSTS)) return 'github'
  if (hostMatches(host, VIDEO_HOSTS)) return 'video'
  if (hostMatches(host, SOCIAL_HOSTS)) return 'social'
  if (hostMatches(host, PDF_HOSTS)) return 'pdf'
  if (pathname.toLowerCase().endsWith('.pdf')) return 'pdf'
  return 'article'
}

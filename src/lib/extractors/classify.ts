/**
 * Kind classifier: canonical URL -> ItemKind. Each extractor's own `matches()` re-derives the
 * same host checks (a registry picks an extractor by `matches()`, not by kind alone, since
 * `social` covers both Instagram and X/Threads) — this function is the single source of truth
 * both lean on, so the two can never silently disagree.
 *
 * No extractor for `audio` exists in P2 (out of scope — see the P2 task list), but the kind still
 * classifies correctly for when one is added; until then it's simply a kind with no registered
 * extractor, the same as any URL a future kind might cover.
 */
import { ItemKind } from '@/types/contracts'
import { canonicalizeUrlSync } from './canonicalize'

const GITHUB_HOSTS = new Set(['github.com'])
const VIDEO_HOSTS = new Set(['youtube.com'])
const SOCIAL_HOSTS = new Set(['x.com', 'instagram.com', 'threads.net', 'threads.com'])
const AUDIO_HOSTS = new Set(['soundcloud.com', 'open.spotify.com', 'anchor.fm'])
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac'])

function extensionOf(pathname: string): string {
  const lastDot = pathname.lastIndexOf('.')
  const lastSlash = pathname.lastIndexOf('/')
  if (lastDot <= lastSlash) return ''
  return pathname.slice(lastDot)
}

export function classifyKind(rawUrl: string): ItemKind {
  let parsed: URL
  try {
    parsed = new URL(canonicalizeUrlSync(rawUrl))
  } catch {
    return ItemKind.Other
  }

  const host = parsed.hostname
  const pathLower = parsed.pathname.toLowerCase()

  if (GITHUB_HOSTS.has(host)) return ItemKind.Github
  if (VIDEO_HOSTS.has(host)) return ItemKind.Video
  if (SOCIAL_HOSTS.has(host)) return ItemKind.Social
  if (host === 'arxiv.org' || pathLower.endsWith('.pdf')) return ItemKind.Pdf
  if (AUDIO_HOSTS.has(host) || AUDIO_EXTENSIONS.has(extensionOf(pathLower))) return ItemKind.Audio
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return ItemKind.Article
  return ItemKind.Other
}

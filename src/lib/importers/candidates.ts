import { classifyLinkKind } from './kind'
import { extractUrls } from './url-extract'
import { computeUrlHash, type UrlCanonicalizer } from './url-hash'
import {
  IMPORT_LINK_KINDS,
  type ChatParseResult,
  type ImportLinkCandidate,
  type ImportLinkKind,
} from './types'

export function emptyKindCounts(): Record<ImportLinkKind, number> {
  const counts = {} as Record<ImportLinkKind, number>
  for (const k of IMPORT_LINK_KINDS) counts[k] = 0
  return counts
}

/**
 * One message containing N URLs becomes N candidates, each keeping the FULL message as
 * its note (P12.2/§3's "surrounding message text as a note") and the message's
 * ORIGINAL timestamp — never the import time, so a two-year-old backlog still sorts
 * correctly by share date after import (docs/API.md §3.10).
 */
export function buildCandidates(
  parsed: ChatParseResult,
  canonicalize?: UrlCanonicalizer,
): ImportLinkCandidate[] {
  const candidates: ImportLinkCandidate[] = []
  for (const message of parsed.messages) {
    for (const url of extractUrls(message.text)) {
      candidates.push({
        url,
        urlHash: computeUrlHash(url, canonicalize),
        kind: classifyLinkKind(url),
        createdAt: message.timestampMs,
        note: message.text,
        author: message.author,
        sourceLineNumber: message.lineNumber,
      })
    }
  }
  return candidates
}

export interface DedupeResult {
  unique: ImportLinkCandidate[]
  duplicateCount: number
}

/**
 * De-dupes by `url_hash` BEFORE anything is enqueued (P12.4) — both against links
 * already in the library (`existingUrlHashes`) and against repeats within the same
 * export, so re-importing the same file twice adds nothing the second time.
 */
export function dedupeCandidates(
  candidates: readonly ImportLinkCandidate[],
  existingUrlHashes: ReadonlySet<string> = new Set(),
): DedupeResult {
  const seen = new Set(existingUrlHashes)
  const unique: ImportLinkCandidate[] = []
  let duplicateCount = 0
  for (const candidate of candidates) {
    if (seen.has(candidate.urlHash)) {
      duplicateCount++
      continue
    }
    seen.add(candidate.urlHash)
    unique.push(candidate)
  }
  return { unique, duplicateCount }
}

export function countByKind(
  candidates: readonly ImportLinkCandidate[],
): Record<ImportLinkKind, number> {
  const counts = emptyKindCounts()
  for (const c of candidates) counts[c.kind]++
  return counts
}

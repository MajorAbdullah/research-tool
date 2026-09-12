/**
 * Payload-cap truncation for captured content (P4.2.5 / docs/API.md §1.7).
 *
 * Rule: truncate content, NEVER drop the request. If `html`/`transcript`/
 * `caption` together would push the request over the cap, shrink them (the
 * content fields only — `url`/`title`/`note` are always left alone, they're
 * tiny by comparison and dropping/mangling a user's own note would be worse
 * than a slightly smaller cap) until the total fits, and say so via
 * `truncated: true` rather than silently sending a clipped payload.
 *
 * Pure and framework-free on purpose: no `chrome.*`, no DOM — this is the
 * one piece of the extraction pipeline cheap to unit test exhaustively, so
 * it is (see tests/unit/truncate.test.ts).
 */

import { PAYLOAD_CAP_BYTES } from './constants'

export interface CapturedContent {
  html?: string
  transcript?: string
  caption?: string
}

export interface CappedContent extends CapturedContent {
  truncated: boolean
}

const TRUNCATION_MARKER =
  '\n\n[…truncated by the Sieve extension: this field exceeded the 1 MB capture limit…]'

const CONTENT_FIELDS = ['html', 'transcript', 'caption'] as const

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff
}

/**
 * Cut `value` down to at most `maxBytes` UTF-8 bytes without splitting a
 * multi-byte character or a UTF-16 surrogate pair in half.
 *
 * Uses JS string length as a first approximation of the cut point (exact for
 * ASCII, always an *overestimate* of the true byte-equivalent length for
 * anything else — a code unit is never fewer than 1 byte in UTF-8 — so the
 * approximate cut is always at or past the real target, safe to shrink
 * further but never in need of growing back). The follow-up loop then trims
 * off the last handful of bytes of overshoot one UTF-16 code unit at a time.
 * This keeps the whole operation close to O(n) even for multi-megabyte
 * input: the expensive re-encode-and-measure step only ever runs a few times
 * near the boundary, not once per character of the original string.
 *
 * One more fix-up after that loop: `TextEncoder` doesn't throw on a lone
 * (unpaired) UTF-16 surrogate — it silently substitutes the U+FFFD
 * replacement character (3 bytes), which means the byte-length check above
 * can be satisfied at a boundary that lands in the middle of a surrogate
 * pair without ever registering as "too long". Explicitly checking for a
 * dangling high surrogate at the cut point (and dropping it) catches what
 * the byte-length measurement alone cannot.
 */
function truncateToBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (byteLength(value) <= maxBytes) return value

  let end = Math.min(value.length, maxBytes)
  while (end > 0 && byteLength(value.slice(0, end)) > maxBytes) {
    end -= 1
  }
  if (end > 0 && isHighSurrogate(value.charCodeAt(end - 1))) {
    end -= 1
  }
  return value.slice(0, end)
}

/**
 * Shrink `html`/`transcript`/`caption` (whichever are present) so their
 * combined UTF-8 byte size fits within `maxBytes`, distributing the
 * available budget proportionally to each field's current size — a large
 * field gives up proportionally more, rather than one field being zeroed out
 * to spare another.
 */
export function capContentPayload(
  input: CapturedContent,
  maxBytes: number = PAYLOAD_CAP_BYTES,
): CappedContent {
  const present = CONTENT_FIELDS.map((field) => ({
    field,
    value: input[field],
    size: input[field] !== undefined ? byteLength(input[field] as string) : 0,
  })).filter((entry) => entry.value !== undefined)

  const total = present.reduce((sum, entry) => sum + entry.size, 0)

  if (total <= maxBytes) {
    return { ...input, truncated: false }
  }

  const markerBytes = byteLength(TRUNCATION_MARKER)
  const result: CappedContent = { truncated: true }

  for (const entry of present) {
    const share = entry.size / total
    // Reserve room for the marker so the final string (content + marker)
    // still fits its share of the budget, not just the content alone.
    const budget = Math.max(0, Math.floor(maxBytes * share) - markerBytes)
    const original = entry.value as string
    const kept = truncateToBytes(original, budget)
    if (kept.length < original.length) {
      result[entry.field] = kept + TRUNCATION_MARKER
    } else {
      result[entry.field] = kept
    }
  }

  return result
}

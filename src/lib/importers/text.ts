/**
 * WhatsApp exports routinely embed invisible Unicode formatting characters — most notably
 * U+200E (LEFT-TO-RIGHT MARK) and U+200F (RIGHT-TO-LEFT MARK), inserted by WhatsApp/iOS
 * around dates, author names and pasted links so they render correctly in RTL locales
 * (Arabic, Urdu, Hebrew, ...). Left in place, they sit between characters a naive
 * `^\[...\]` / `^\d+\/\d+...` regex expects to be adjacent, which is the single most common
 * cause of a WhatsApp parser silently matching almost nothing. We strip these (and a
 * handful of related bidi/format characters, plus a leading BOM) from every physical line
 * before any pattern matching happens — never assumed absent, always tolerated.
 *
 * Deliberately built from numeric code points via `String.fromCodePoint` rather than typed
 * as literal characters (or even `\u` escapes) in this file: a zero-width character sitting
 * directly in source is invisible in a diff/review and easy to miscount or corrupt in
 * transit, which is exactly the failure mode this module exists to defend against in
 * *input* data. Spelling the code points out as plain numbers keeps this file fully ASCII
 * and its content mechanically verifiable.
 */
const ZERO_WIDTH_SPACE = 0x200b
const ZERO_WIDTH_NON_JOINER = 0x200c
const ZERO_WIDTH_JOINER = 0x200d
const LEFT_TO_RIGHT_MARK = 0x200e
const RIGHT_TO_LEFT_MARK = 0x200f
const BIDI_EMBEDDING_AND_OVERRIDE_START = 0x202a
const BIDI_EMBEDDING_AND_OVERRIDE_END = 0x202e
const BIDI_ISOLATE_START = 0x2066
const BIDI_ISOLATE_END = 0x2069
const BYTE_ORDER_MARK = 0xfeff

const NO_BREAK_SPACE = 0x00a0
const NARROW_NO_BREAK_SPACE = 0x202f

/** Inclusive code-point range, expanded below. */
function range(start: number, end: number): number[] {
  const out: number[] = []
  for (let cp = start; cp <= end; cp++) out.push(cp)
  return out
}

/**
 * NOTE the ranges. The two bidi groups are CONTIGUOUS BLOCKS, not pairs of individual
 * characters, and listing only their endpoints was a real bug: it let U+202B
 * RIGHT-TO-LEFT EMBEDDING, U+202C POP DIRECTIONAL FORMATTING, U+202D/E the overrides,
 * and U+2067/2068 the remaining isolates through untouched. Those are exactly the
 * characters an Arabic- or Urdu-locale WhatsApp export is full of, so a line containing
 * one would have failed to match the timestamp pattern and been silently skipped.
 *
 *   0x202A-0x202E  LRE, RLE, PDF, LRO, RLO
 *   0x2066-0x2069  LRI, RLI, FSI, PDI
 */
const INVISIBLE_MARK_CODEPOINTS: readonly number[] = [
  ZERO_WIDTH_SPACE,
  ZERO_WIDTH_NON_JOINER,
  ZERO_WIDTH_JOINER,
  LEFT_TO_RIGHT_MARK,
  RIGHT_TO_LEFT_MARK,
  ...range(BIDI_EMBEDDING_AND_OVERRIDE_START, BIDI_EMBEDDING_AND_OVERRIDE_END),
  ...range(BIDI_ISOLATE_START, BIDI_ISOLATE_END),
  BYTE_ORDER_MARK,
]

const SPECIAL_SPACE_CODEPOINTS: readonly number[] = [NO_BREAK_SPACE, NARROW_NO_BREAK_SPACE]

function charClass(codepoints: readonly number[]): RegExp {
  const chars = codepoints.map((cp) => String.fromCodePoint(cp)).join('')
  return new RegExp(`[${chars}]`, 'g')
}

const INVISIBLE_MARKS_RE = charClass(INVISIBLE_MARK_CODEPOINTS)
const SPECIAL_SPACE_RE = charClass(SPECIAL_SPACE_CODEPOINTS)

/** Strip invisible direction marks and normalize special spaces on one physical line. */
export function normalizeLine(raw: string): string {
  return raw.replace(INVISIBLE_MARKS_RE, '').replace(SPECIAL_SPACE_RE, ' ')
}

/** Split on any line-ending style (Unix, Windows, or classic Mac) uniformly. */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/)
}

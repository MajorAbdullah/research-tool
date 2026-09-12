import { normalizeLine, splitLines } from './text'
import {
  buildTimestampMs,
  detectDateOrder,
  normalizeYear,
  type RawTimestampComponents,
} from './timestamp'
import type {
  ChatParseResult,
  ParsedWhatsAppMessage,
  SkippedLine,
  WhatsAppSourceFormat,
} from './types'

// [12/09/2026, 4:35:12 PM] Name: message   (iOS)
const IOS_HEADER_RE =
  /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\]\s(.*)$/

// 12/09/2026, 16:35 - Name: message         (Android)
const ANDROID_HEADER_RE =
  /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\s-\s(.*)$/

// A line that's clearly ATTEMPTING to be a timestamp header (starts with a date-shaped
// prefix) but doesn't fully match either format above — e.g. an impossible date, or a
// header mangled by some other export/conversion tool. This must be flagged, never
// silently merged into the previous message as a continuation line.
const HEADER_LOOKS_LIKE_RE = /^\[?\d{1,2}\/\d{1,2}\/\d{2,4},/

/**
 * WhatsApp system notifications ("X joined", the encryption notice, "X left") have no
 * "Name: " prefix at all — just a plain sentence. Real messages are always
 * "Author: text". The first ": " in the remainder is reliably the author/text
 * boundary in every real export we've seen; a colon that happens to appear later in
 * the message body never matters because we split on the FIRST occurrence. (Known
 * limitation: a system message whose sentence itself contains ": ", e.g. a group
 * description changed to text containing a colon, would be mis-split. This is a
 * shared limitation of every colon-heuristic WhatsApp parser, not unique to this one.)
 */
function splitAuthorAndBody(rest: string): { author: string | null; text: string } {
  const idx = rest.indexOf(': ')
  if (idx === -1) return { author: null, text: rest }
  return { author: rest.slice(0, idx), text: rest.slice(idx + 2) }
}

function toComponents(groups: {
  d1: string
  d2: string
  y: string
  hh: string
  mm: string
  ss: string | undefined
  mer: string | undefined
}): RawTimestampComponents {
  return {
    comp1: Number(groups.d1),
    comp2: Number(groups.d2),
    year: normalizeYear(groups.y),
    hour: Number(groups.hh),
    minute: Number(groups.mm),
    second: groups.ss ? Number(groups.ss) : 0,
    meridiem: groups.mer ? (groups.mer.toUpperCase() as 'AM' | 'PM') : null,
  }
}

interface HeaderToken {
  kind: 'header'
  lineNumber: number
  style: 'ios' | 'android'
  fullLine: string
  author: string | null
  body: string
  components: RawTimestampComponents
}

interface ContinuationToken {
  kind: 'continuation'
  lineNumber: number
  raw: string
}

interface UnparseableToken {
  kind: 'unparseable'
  lineNumber: number
  raw: string
  reason: string
}

type Token = HeaderToken | ContinuationToken | UnparseableToken

function tokenizeLine(rawLine: string, lineNumber: number): Token | null {
  const line = normalizeLine(rawLine)
  if (line.trim() === '') return null // blank lines carry no content either way

  const ios = IOS_HEADER_RE.exec(line)
  if (ios) {
    const components = toComponents({
      d1: ios[1]!,
      d2: ios[2]!,
      y: ios[3]!,
      hh: ios[4]!,
      mm: ios[5]!,
      ss: ios[6],
      mer: ios[7],
    })
    const { author, text } = splitAuthorAndBody(ios[8]!)
    return {
      kind: 'header',
      lineNumber,
      style: 'ios',
      fullLine: line,
      author,
      body: text,
      components,
    }
  }

  const android = ANDROID_HEADER_RE.exec(line)
  if (android) {
    const components = toComponents({
      d1: android[1]!,
      d2: android[2]!,
      y: android[3]!,
      hh: android[4]!,
      mm: android[5]!,
      ss: android[6],
      mer: android[7],
    })
    const { author, text } = splitAuthorAndBody(android[8]!)
    return {
      kind: 'header',
      lineNumber,
      style: 'android',
      fullLine: line,
      author,
      body: text,
      components,
    }
  }

  if (HEADER_LOOKS_LIKE_RE.test(line)) {
    return {
      kind: 'unparseable',
      lineNumber,
      raw: rawLine,
      reason:
        'line looks like a timestamp header but does not match a known WhatsApp export format',
    }
  }

  return { kind: 'continuation', lineNumber, raw: line }
}

/**
 * Parses a WhatsApp `_chat.txt` export (iOS and Android formats, both clocks, both
 * date orders — see P12.1). Never throws on unrecognized input: everything that isn't
 * a valid message ends up in `skipped` with a reason instead of being silently
 * dropped, and a malformed line never corrupts the message it happens to sit next to.
 */
export function parseWhatsAppChat(rawText: string): ChatParseResult {
  const lines = splitLines(rawText)
  const tokens: Token[] = []
  for (let i = 0; i < lines.length; i++) {
    const token = tokenizeLine(lines[i]!, i + 1)
    if (token) tokens.push(token)
  }

  // Day/month order can only be resolved after seeing every header in the file (a
  // single disambiguating line anywhere is enough — see timestamp.ts), so timestamps
  // are built in a second pass, once `dateFormat` is known.
  const dateFormat = detectDateOrder(
    tokens.filter((t): t is HeaderToken => t.kind === 'header').map((t) => t.components),
  )

  const skipped: SkippedLine[] = []
  const messages: ParsedWhatsAppMessage[] = []
  let iosCount = 0
  let androidCount = 0

  let pending: {
    lineNumber: number
    author: string | null
    parts: string[]
    timestampMs: number
  } | null = null
  let seenAnyValidHeader = false

  const flushPending = () => {
    if (!pending) return
    messages.push({
      lineNumber: pending.lineNumber,
      timestampMs: pending.timestampMs,
      author: pending.author,
      text: pending.parts.join('\n'),
      isSystem: pending.author === null,
    })
    pending = null
  }

  for (const tok of tokens) {
    if (tok.kind === 'header') {
      flushPending()
      const built = buildTimestampMs(tok.components, dateFormat.order)
      if (!built.ok) {
        skipped.push({
          lineNumber: tok.lineNumber,
          raw: tok.fullLine,
          reason: `invalid date/time in timestamp header: ${built.reason}`,
        })
        continue
      }
      if (tok.style === 'ios') iosCount++
      else androidCount++
      seenAnyValidHeader = true
      pending = {
        lineNumber: tok.lineNumber,
        author: tok.author,
        parts: [tok.body],
        timestampMs: built.timestampMs,
      }
    } else if (tok.kind === 'unparseable') {
      flushPending()
      skipped.push({ lineNumber: tok.lineNumber, raw: tok.raw, reason: tok.reason })
    } else {
      // continuation
      if (pending) {
        pending.parts.push(tok.raw)
      } else {
        skipped.push({
          lineNumber: tok.lineNumber,
          raw: tok.raw,
          reason: seenAnyValidHeader
            ? 'no active message to attach this line to (the preceding header was invalid or unparseable)'
            : 'text before any recognized message header',
        })
      }
    }
  }
  flushPending()

  let sourceFormat: WhatsAppSourceFormat
  if (iosCount > 0 && androidCount > 0) sourceFormat = 'mixed'
  else if (androidCount > 0) sourceFormat = 'android'
  else sourceFormat = 'ios'

  return { messages, skipped, sourceFormat, dateFormat }
}

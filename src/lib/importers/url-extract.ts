const URL_RE = /(https?:\/\/[^\s]+)|(\bwww\.[^\s]+)/gi

const TRAILING_PUNCTUATION = new Set(['.', ',', '!', '?', ':', ';', '"', "'", '*', '`'])
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

function countChar(s: string, ch: string): number {
  let count = 0
  for (const c of s) if (c === ch) count++
  return count
}

/**
 * Prose routinely wraps a pasted link in punctuation ("check this out: https://x.com/y."
 * or "(see https://x.com/y)") — that trailing punctuation is never part of the URL. A
 * trailing closing bracket is the one case that needs care: Wikipedia-style URLs
 * legitimately end in `)` (e.g. `.../Bidirectional_text_(computing)`), so a closer is
 * only trimmed when it's NOT balanced by an opener earlier in the same candidate.
 */
function trimTrailingPunctuation(input: string): string {
  let out = input
  while (out.length > 0) {
    const last = out[out.length - 1]!
    const opener = CLOSERS[last]
    if (opener) {
      const opens = countChar(out, opener)
      const closes = countChar(out, last)
      if (closes <= opens) break // every closer has a matching opener - genuinely part of the URL
      out = out.slice(0, -1)
      continue
    }
    if (TRAILING_PUNCTUATION.has(last)) {
      out = out.slice(0, -1)
      continue
    }
    break
  }
  return out
}

/** Extracts every URL in `text`, trimmed of trailing prose punctuation, in order of appearance. */
export function extractUrls(text: string): string[] {
  const matches = text.match(URL_RE) ?? []
  return matches
    .map(trimTrailingPunctuation)
    .filter((m) => m.length > 0)
    .map((m) => (m.slice(0, 4).toLowerCase() === 'www.' ? `https://${m}` : m))
}

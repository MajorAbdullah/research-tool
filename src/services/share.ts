/**
 * Parsing for the Android PWA Web Share Target POST (docs/API.md's `/share` callout, §1.2). The
 * quirk this exists for: apps like Instagram put the shared URL inside the `text` field, not
 * `url` — `resolveSharePayload` tries `url` first, then hunts for an http(s) URL inside `text`,
 * keeping whatever's left over as the note/caption.
 */

import { isHttpUrl } from '@/services/url'

export interface ResolvedShare {
  url: string
  note?: string
}

const URL_PATTERN = /https?:\/\/\S+/i
// Trailing punctuation a sentence wraps around a URL with (e.g. "check this out: <url>.") —
// stripped from the END of a match only, never from the middle of the URL itself.
const TRAILING_PUNCTUATION = /[.,!?)\]}'">]+$/

function extractUrlFromText(text: string): { url: string; rest: string } | null {
  const match = URL_PATTERN.exec(text)
  if (!match) return null

  const url = match[0].replace(TRAILING_PUNCTUATION, '')
  if (url.length === 0) return null

  // The trailing punctuation the regex swallowed (e.g. a sentence-ending period right after the
  // URL) is discarded entirely, not reattached to `rest` — it was never part of the note, just
  // incidental to how the URL sat inside a sentence.
  const before = text.slice(0, match.index)
  const after = text.slice(match.index + match[0].length)
  // Collapse the whitespace seam left behind where the URL used to be (e.g. "out: <url> so" ->
  // "out:  so", two spaces) down to one, rather than leaving a visible double space in the note.
  const rest = `${before} ${after}`.replace(/\s+/g, ' ').trim()

  return { url, rest }
}

/**
 * `urlField`/`textField` are exactly the Web Share Target `url`/`text` form fields as submitted
 * (already coerced to `""` if absent — see the route). Returns `null` if no URL could be found
 * anywhere in either field.
 */
export function resolveSharePayload(urlField: string, textField: string): ResolvedShare | null {
  if (isHttpUrl(urlField)) {
    return { url: urlField, note: textField.trim() || undefined }
  }

  const fromText = extractUrlFromText(textField)
  if (fromText) {
    return { url: fromText.url, note: fromText.rest || undefined }
  }

  // Last resort: some caller crammed a sentence into the `url` field itself.
  const fromUrlField = extractUrlFromText(urlField)
  if (fromUrlField) {
    const note = [fromUrlField.rest, textField.trim()].filter(Boolean).join('\n\n')
    return { url: fromUrlField.url, note: note || undefined }
  }

  return null
}

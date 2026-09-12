/**
 * Citation validation (P13.2): a chat answer is only as trustworthy as its citations, so this
 * module is the one place that decides whether an answer's `[n]` markers are acceptable —
 * present, and every one of them pointing at a source the model was actually given. Pure string
 * parsing, no I/O, unit-tested directly.
 *
 * Also recognizes the model's own "I don't have this" phrasing, so a legitimately-uncited refusal
 * (rag-best-practices §4's "explicit insufficient-information path") is never punished by the
 * corrective retry `answer.ts` runs for a genuinely uncited *claim*.
 */

const CITATION_MARKER = /\[(\d{1,3})\]/g

/** Every distinct citation index referenced in `text`, in first-seen order. `[1][2]` and `[1] and
 *  [2]` both parse the same way — inline adjacency vs. prose makes no difference here. */
export function extractCitationIndices(text: string): number[] {
  const seen = new Set<number>()
  const indices: number[] = []
  for (const match of text.matchAll(CITATION_MARKER)) {
    const raw = match[1]
    if (!raw) continue
    const n = Number.parseInt(raw, 10)
    if (!seen.has(n)) {
      seen.add(n)
      indices.push(n)
    }
  }
  return indices
}

export interface CitationValidation {
  valid: boolean
  citedIndices: number[]
  /** `true` when at least one `[n]`-shaped marker was found, valid or not — distinguishes "cited
   *  nothing" from "cited something out of range" for logging/diagnostics. */
  hasAnyMarker: boolean
}

/**
 * `sourceCount` is how many numbered sources the model was actually given (`ChatSource[].length`
 * for this turn). With zero sources there is nothing to cite, so an uncited answer is trivially
 * valid (this only happens on the ungrounded path, which never reaches generation at all today,
 * but the function stays correct if that ever changes). With `sourceCount > 0`, valid means: at
 * least one citation marker, and every marker is in range `[1, sourceCount]` — an out-of-range
 * index (the model inventing a `[9]` when it was given 3 sources) is exactly as invalid as citing
 * nothing at all.
 */
export function validateCitations(text: string, sourceCount: number): CitationValidation {
  const citedIndices = extractCitationIndices(text)
  if (sourceCount === 0) {
    return { valid: true, citedIndices, hasAnyMarker: citedIndices.length > 0 }
  }
  const inRange = citedIndices.length > 0 && citedIndices.every((i) => i >= 1 && i <= sourceCount)
  return { valid: inRange, citedIndices, hasAnyMarker: citedIndices.length > 0 }
}

/**
 * Loose, intentionally permissive match for the model organically declining to answer (e.g. "I
 * don't have anything saved about Kubernetes operators"). This is a *secondary* signal, not the
 * primary hallucination guard (that's the pre-generation gate in `groundedness.ts` plus the
 * mandatory-citation check above) — it exists so a legitimate, well-behaved refusal doesn't get
 * dragged through a pointless corrective retry just because it has no `[n]` markers (correctly:
 * there's nothing to cite when you're saying you found nothing).
 *
 * `APOS` matches both a plain ASCII apostrophe and the Unicode right single quotation mark
 * (`'`, U+2019) — verified against real model output (and this file's own test fixtures) using
 * "smart quotes" in contractions; matching only `'` silently missed every one of them.
 */
const APOS = `['’]`
const REFUSAL_PATTERNS: RegExp[] = [
  new RegExp(`\\bnothing (?:saved|in (?:your|my) library|i${APOS}?ve saved)\\b`, 'i'),
  new RegExp(`\\bdon${APOS}?t have (?:anything|any (?:information|items|notes|saved))\\b`, 'i'),
  /\bno(?:thing)? (?:saved|relevant|matching) (?:items?|information)?\s*(?:found|about|on)\b/i,
  new RegExp(`\\bcouldn${APOS}?t find (?:anything|any(?:thing)?)\\b`, 'i'),
  new RegExp(`\\bdoesn${APOS}?t (?:appear to|seem to)? ?cover\\b`, 'i'),
  /\bnot (?:something|anything) (?:you|i) saved\b/i,
  new RegExp(`\\bi don${APOS}?t see anything\\b`, 'i'),
]

export function looksLikeRefusal(text: string): boolean {
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(text))
}

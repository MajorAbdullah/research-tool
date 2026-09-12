/**
 * Turns arbitrary user search text into a safe FTS5 MATCH expression.
 *
 * FTS5's query syntax has real syntax errors a plain user can trigger by accident — a stray `"`,
 * a trailing `*`, `NEAR`, or the uppercase boolean operators `AND`/`OR`/`NOT` all mean something
 * to the MATCH parser and throw `fts5: syntax error near ...` if malformed. Rather than trying to
 * escape the user's original string, this module never passes it through at all: it tokenizes the
 * input down to plain alphanumeric words *itself*, discarding every FTS5-meaningful character in
 * the process, then rebuilds a query from those tokens under our own control. There is nothing
 * left for a user (or an attacker) to inject — the only literal syntax in the emitted string
 * (`OR`, the quotes, the trailing `*`) is ours, never theirs.
 *
 * Terms are OR-ed together (not AND-ed), and every term gets a trailing `*` for prefix matching
 * ("diffus" -> "diffus*" matches "diffusion"). OR, not AND, is deliberate: a natural-language
 * query like "how should I combine keyword and vector search" would AND itself into requiring
 * every one of "how"/"should"/"i" etc. in the same row, matching almost nothing. `bm25()` ranking
 * already rewards rows that match more/rarer terms, so OR plus ranking behaves like ordinary
 * keyword search rather than a brittle phrase match.
 */

/** Unicode-aware "word" extraction — letters/digits in any script, so this isn't ASCII-only. */
const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu

/** Hard cap on how many terms go into one MATCH expression — bounds query cost for a pathological
 *  (very long) input without needing to reject it outright. */
export const MAX_FTS_TERMS = 24

/**
 * Extracts safe, lowercased word tokens from arbitrary text, deduped in first-seen order. Exposed
 * on its own (not just via `buildFtsMatchExpression`) since callers may want the plain token list
 * without MATCH-specific syntax wrapped around it.
 */
export function tokenizeForFts(raw: string): string[] {
  const matches = raw.toLowerCase().match(TOKEN_PATTERN)
  if (!matches) return []

  const seen = new Set<string>()
  const tokens: string[] = []
  for (const token of matches) {
    if (seen.has(token)) continue
    seen.add(token)
    tokens.push(token)
    if (tokens.length >= MAX_FTS_TERMS) break
  }
  return tokens
}

/**
 * Builds a `MATCH`-ready FTS5 query string, or `null` when the input has no usable tokens (pure
 * punctuation/emoji/whitespace) — callers should skip the FTS5 query entirely in that case rather
 * than sending an empty/invalid MATCH string.
 */
export function buildFtsMatchExpression(raw: string): string | null {
  const tokens = tokenizeForFts(raw)
  if (tokens.length === 0) return null

  // Each token is quoted before its trailing `*`: FTS5 accepts `"token"*` as a quoted prefix
  // query (verified against the installed fts5 build), and quoting is defense-in-depth against
  // any future change to `TOKEN_PATTERN` that might otherwise let a special character through —
  // there should never be anything inside the quotes that needs escaping, since the tokenizer
  // only ever emits `\p{L}\p{N}` sequences, but the quotes cost nothing and remove the question.
  return tokens.map((token) => `"${token}"*`).join(' OR ')
}

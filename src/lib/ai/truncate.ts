/**
 * Token-budgeted head+tail truncation (P3.2.4). This is the last-resort safety clamp *beneath*
 * the long-content router (`long-content-router.ts`): the router already picks the largest-context
 * chain when content overflows Chain A, so this only fires for content too large for *any*
 * configured model. When it must cut, it keeps both ends rather than just the head — "a 60-minute
 * transcript fits context without losing the conclusion" (P3.1.1b's acceptance criterion) means
 * the ending has to survive even when the middle doesn't.
 */

import { tokenBudgetToChars } from './token-estimate'

export interface TruncationResult {
  text: string
  truncated: boolean
}

const TRUNCATION_MARKER = '\n\n[... content truncated to fit the model’s context window ...]\n\n'

/**
 * `headRatio` is the share of the kept budget given to the start of the document; the rest goes
 * to the end. Defaults to keeping more of the head (titles/intros usually front-load context)
 * while still guaranteeing a real tail, not just "everything after the cut is gone."
 */
export function truncateToTokenBudget(
  text: string,
  maxTokens: number,
  headRatio = 0.7,
): TruncationResult {
  const budgetChars = tokenBudgetToChars(maxTokens)
  if (text.length <= budgetChars) {
    return { text, truncated: false }
  }
  const markerChars = TRUNCATION_MARKER.length
  const keepChars = Math.max(0, budgetChars - markerChars)
  const headChars = Math.floor(keepChars * headRatio)
  const tailChars = keepChars - headChars
  const head = text.slice(0, headChars)
  const tail = tailChars > 0 ? text.slice(text.length - tailChars) : ''
  return { text: `${head}${TRUNCATION_MARKER}${tail}`, truncated: true }
}

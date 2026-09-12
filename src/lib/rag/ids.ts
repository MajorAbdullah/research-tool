/**
 * Opaque wire ids for this phase's own resources (`cnv_...` conversations, `msg_...` messages),
 * plus a local item-id parser for reading `hybridSearch()`'s own `itm_...` ids back into the
 * numeric row id `chunks`/`items` are keyed by.
 *
 * Deliberately a small local copy rather than importing `src/services/ids.ts` (P8-owned) or
 * `src/lib/search/item-summary.ts`'s `toItemWireId` (P9-owned, not exported for reuse anyway) —
 * this mirrors the existing precedent: `item-summary.ts` itself doesn't import P8's id helper
 * either. Every phase keeps its own tiny id-mapping local rather than reaching across the
 * phase-ownership boundary for ~10 lines (CLAUDE.md: "stay inside the paths your phase owns").
 * Same `<prefix>_<digits>` shape and validation as both of those, so the format stays consistent
 * project-wide even without a shared implementation.
 */

const ITEM_PREFIX = 'itm_'
const CONVERSATION_PREFIX = 'cnv_'
const MESSAGE_PREFIX = 'msg_'

const DIGITS_ONLY = /^[1-9][0-9]*$/

function fromPrefixedId(id: string, prefix: string): number | null {
  if (!id.startsWith(prefix)) return null
  const rest = id.slice(prefix.length)
  if (!DIGITS_ONLY.test(rest)) return null
  const rowId = Number.parseInt(rest, 10)
  return Number.isSafeInteger(rowId) ? rowId : null
}

/** `hybridSearch()`'s `SearchResultItem.id` -> the numeric `items.id` row id, or `null` if it
 *  isn't validly shaped (defensive only — every id retrieve.ts sees was just produced by
 *  `hybridSearch()` itself, never client input). */
export function parseItemWireId(id: string): number | null {
  return fromPrefixedId(id, ITEM_PREFIX)
}

export function toConversationWireId(rowId: number): string {
  return `${CONVERSATION_PREFIX}${rowId}`
}

/** A `conversation_id` on `POST /api/v1/chat` IS client-supplied (docs/API.md §3.8) — unlike the
 *  item-id case above, this one genuinely needs to reject a malformed/foreign value, which the
 *  route treats as "start a new conversation instead" rather than a hard error (a stale or
 *  tampered id shouldn't break the chat). */
export function parseConversationWireId(id: string): number | null {
  return fromPrefixedId(id, CONVERSATION_PREFIX)
}

export function toMessageWireId(rowId: number): string {
  return `${MESSAGE_PREFIX}${rowId}`
}

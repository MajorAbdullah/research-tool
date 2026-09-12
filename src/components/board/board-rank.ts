/**
 * Fractional ranking for manual ordering within a board column (plan §10, P11.4: "Manual ordering
 * within a column (fractional board_rank)"). Standard fractional-index technique: moving an item
 * assigns it exactly ONE new number — the midpoint of its new neighbors' ranks — so a reorder
 * never has to rewrite every other row, which is the entire point of a fractional scheme over a
 * plain integer position column.
 *
 * IMPORTANT — see rank-store.ts's own comment and the phase report: `board_rank` currently has no
 * write path anywhere in the backend this phase is scoped to leave untouched. Verified live:
 * `PATCH /api/v1/items/:id` is `.strict()` in `src/services/items-schema.ts` and does not list
 * `board_rank` among its fields — sending it 400s with `VALIDATION_ERROR: "Unrecognized key:
 * board_rank"` — and `PATCH .../status` only ever writes `status`. This module's output is
 * applied to the local override store (rank-store.ts), not sent to the server.
 */

const BASE_STEP = 1024

/** Below this gap, a float midpoint would round back to one of its neighbors — time to rebalance. */
const MIN_GAP = 1e-7

/**
 * A rank strictly between `lo` and `hi` (either bound `null` meaning "no neighbor on that side").
 * Both `null` (empty column) returns a default starting rank rather than 0, leaving room to
 * insert before it later without an immediate rebalance.
 */
export function computeRankBetween(lo: number | null, hi: number | null): number {
  if (lo === null) {
    return hi === null ? BASE_STEP : hi - BASE_STEP
  }
  if (hi === null) return lo + BASE_STEP
  return (lo + hi) / 2
}

/** True once `lo`/`hi` are close enough that their float midpoint would collide with a neighbor. */
export function needsRebalance(lo: number | null, hi: number | null): boolean {
  if (lo === null || hi === null) return false
  return hi - lo < MIN_GAP
}

/** Fresh, evenly-spaced ranks for a whole column, in the given (already-ordered) id sequence. */
export function rebalancedRanks(
  orderedIds: readonly string[],
): Array<{ id: string; rank: number }> {
  return orderedIds.map((id, index) => ({ id, rank: (index + 1) * BASE_STEP }))
}

/**
 * Column ordering used everywhere a column's cards are displayed: an explicit rank sorts first
 * (ascending — lower rank nearer the top), and anything unranked falls back to newest-first
 * (matching the library's own "newest" default sort), placed after every explicitly-ranked item
 * so a freshly-captured item doesn't jump above one you deliberately positioned.
 */
export function compareForColumn<T>(
  a: T,
  b: T,
  getRank: (item: T) => number | null,
  getCreatedAt: (item: T) => number,
): number {
  const rankA = getRank(a)
  const rankB = getRank(b)
  if (rankA !== null && rankB !== null) return rankA - rankB
  if (rankA !== null) return -1
  if (rankB !== null) return 1
  return getCreatedAt(b) - getCreatedAt(a)
}

export function sortForColumn<T>(
  items: readonly T[],
  getRank: (item: T) => number | null,
  getCreatedAt: (item: T) => number,
): T[] {
  return [...items].sort((a, b) => compareForColumn(a, b, getRank, getCreatedAt))
}

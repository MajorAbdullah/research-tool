/**
 * Client-side mirror of the status state machine from docs/API.md §3.6, transcribed exactly from
 * `STATUS_TRANSITIONS` in `src/services/items-service.ts`. Verified against the live endpoint
 * while building this phase (see the phase report): the server's actual behavior matches the
 * documented graph exactly, byte for byte, no discrepancies found.
 *
 * This is NOT the source of truth — `PATCH /api/v1/items/:id/status` is, and it validates and
 * rejects with `400 INVALID_STATUS_TRANSITION` regardless of what this module says. This copy
 * exists so the board can pre-validate a drag *before* firing the optimistic update, per
 * docs/API.md §4's own design note: "board UI, which should pre-validate a drag before firing the
 * optimistic update." An obviously-illegal drop (e.g. dragging a card out of Archived/Dropped
 * into Testing) is refused immediately, client-side, with no round trip — the network round trip
 * and rollback path (use-board-data.ts) still exists and is exercised for genuine server-side
 * rejections (stale client data racing a change made elsewhere), just not for cases this module
 * already knows are illegal.
 *
 * Duplicated rather than imported from `src/services/items-service.ts` on purpose: that module
 * pulls in `better-sqlite3`/Drizzle and is server-only — importing it here would drag native
 * database bindings into the client bundle. Same reasoning `src/components/common/types.ts`
 * already documents for its own duplication of `src/types/contracts.ts`.
 */

import { columnByKey, type BoardColumnKey, type ItemStatus } from './board-types'

export const STATUS_TRANSITIONS: Record<ItemStatus, readonly ItemStatus[]> = {
  queued: [],
  processing: [],
  inbox: ['to_test', 'testing', 'tested', 'archived', 'dropped'],
  to_test: ['inbox', 'testing', 'tested', 'archived', 'dropped'],
  testing: ['inbox', 'to_test', 'tested', 'archived', 'dropped'],
  tested: ['inbox', 'to_test', 'testing', 'archived', 'dropped'],
  archived: ['inbox'],
  dropped: ['inbox'],
  failed: [],
}

export function allowedNextStatuses(from: ItemStatus): readonly ItemStatus[] {
  return STATUS_TRANSITIONS[from]
}

export function isValidTransition(from: ItemStatus, to: ItemStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to)
}

/**
 * Whether a dragged card can legally land in `column` at all — true if `column` is the card's
 * OWN current column (staying put — a manual reorder, not a status transition, so it's never
 * blocked by the transition graph at all) or if at least one of the column's backing statuses
 * (plural only for the combined Archived/Dropped column) is reachable from `fromStatus`. Drives
 * the "dim this column while dragging" visual (board-column.tsx) and the pre-drop validation the
 * drag controller checks before ever firing the status mutation.
 *
 * The same-column carve-out matters: `STATUS_TRANSITIONS['inbox']` does not list `'inbox'` itself
 * (a transition table has no self-edges), so without it, dragging a card to reorder it *within*
 * its own column would look "disallowed" and the column would dim itself mid-drag — locked in by
 * a dedicated test case in status-transitions.test.ts after this was caught during development.
 */
export function canDropOnColumn(fromStatus: ItemStatus, column: BoardColumnKey): boolean {
  const config = columnByKey(column)
  const statuses = config.statuses as readonly ItemStatus[]
  if (statuses.includes(fromStatus)) return true
  return statuses.some((status) => isValidTransition(fromStatus, status))
}

/** The intersection of "what's legal from every one of these statuses" — for bulk actions on a mixed selection. */
export function commonAllowedNextStatuses(fromStatuses: readonly ItemStatus[]): ItemStatus[] {
  if (fromStatuses.length === 0) return []
  const [first, ...rest] = fromStatuses
  let allowed = new Set<ItemStatus>(first ? STATUS_TRANSITIONS[first] : [])
  for (const status of rest) {
    const next = new Set(STATUS_TRANSITIONS[status])
    allowed = new Set([...allowed].filter((s) => next.has(s)))
  }
  return [...allowed]
}

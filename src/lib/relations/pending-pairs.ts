/**
 * Collects candidate item pairs awaiting a relation label (P9.2.2's input side).
 *
 * There is no persisted "pending pairs" queue/table anywhere in the schema — adding one would
 * mean a new migration, and this phase doesn't own `drizzle/`. So "pending" is always re-derived
 * on demand: walk candidate items, compute each one's top-K neighbours (`findItemNeighbors`), and
 * keep whichever normalized `(itemA < itemB)` pairs don't already have a `relations` row of any
 * type. Idempotent by construction — re-running after a partial sweep just re-derives the same
 * candidates minus whatever already got labelled.
 */

import type Database from 'better-sqlite3'
import { findItemNeighbors } from './neighbors'

export interface PendingPair {
  itemA: number
  itemB: number
  distance: number
}

/** P9.2.2's batch ceiling — one LLM request covers up to this many pairs. */
export const DEFAULT_MAX_PENDING_PAIRS = 20
export const DEFAULT_NEIGHBORS_PER_ITEM = 5

function normalizePair(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a]
}

function relationAlreadyExists(sqlite: Database.Database, itemA: number, itemB: number): boolean {
  const row = sqlite
    .prepare('SELECT 1 FROM relations WHERE item_a = ? AND item_b = ? LIMIT 1')
    .get(itemA, itemB)
  return row !== undefined
}

function defaultCandidateItemIds(sqlite: Database.Database, userId: number): number[] {
  const rows = sqlite
    .prepare('SELECT DISTINCT item_id AS itemId FROM chunks WHERE user_id = ? ORDER BY item_id')
    .all(userId) as { itemId: number }[]
  return rows.map((r) => r.itemId)
}

export interface CollectPendingPairsOptions {
  userId: number
  /** Candidate items to consider this sweep — defaults to every item this user has at least one
   *  chunk for. P7 may pass a narrower, just-embedded set instead (e.g. from the `relate` job). */
  candidateItemIds?: readonly number[]
  maxPairs?: number
  neighborsPerItem?: number
}

/**
 * Walks candidate items (default: every item this user has chunks for, in id order), computing
 * each one's top-K neighbours and collecting normalized pairs that aren't already labelled — up
 * to `maxPairs` (default 20). Stops as soon as the cap is reached rather than scoring every
 * candidate item every time, since the whole point is bounding the batch fed to one LLM call, not
 * exhaustively re-deriving every neighbour relationship on every sweep.
 *
 * A pair discovered from BOTH directions (item 5's neighbours include item 9, AND item 9's
 * neighbours include item 5) is collected once, not twice.
 */
export function collectPendingPairs(
  sqlite: Database.Database,
  options: CollectPendingPairsOptions,
): PendingPair[] {
  const maxPairs = options.maxPairs ?? DEFAULT_MAX_PENDING_PAIRS
  const neighborsPerItem = options.neighborsPerItem ?? DEFAULT_NEIGHBORS_PER_ITEM
  const candidateItemIds =
    options.candidateItemIds ?? defaultCandidateItemIds(sqlite, options.userId)

  const pairs: PendingPair[] = []
  const seen = new Set<string>()

  for (const itemId of candidateItemIds) {
    if (pairs.length >= maxPairs) break

    const neighbors = findItemNeighbors(sqlite, {
      itemId,
      userId: options.userId,
      topK: neighborsPerItem,
    })

    for (const neighbor of neighbors) {
      if (pairs.length >= maxPairs) break
      const [itemA, itemB] = normalizePair(itemId, neighbor.itemId)
      const key = `${itemA}:${itemB}`
      if (seen.has(key)) continue
      seen.add(key)
      if (relationAlreadyExists(sqlite, itemA, itemB)) continue
      pairs.push({ itemA, itemB, distance: neighbor.distance })
    }
  }

  return pairs
}

/**
 * Inserts labeled pairs into `relations`, respecting `CHECK(item_a < item_b)` and the
 * `(item_a,item_b,type)` unique index (drizzle/0000_init.sql).
 */

import Database from 'better-sqlite3'
import { similarityFromDistance } from './neighbors'
import type { LabeledPair } from './labeling'

export interface StoreRelationsResult {
  inserted: number
  skipped: number
}

/**
 * `collectPendingPairs` already normalizes pair order and skips pairs with an existing row, so
 * neither constraint should normally fire here — but insert-time violations are still caught and
 * counted as `skipped` rather than thrown. Two concurrent sweeps (or a sweep re-run against
 * slightly stale pending-pair data) racing to insert the same pair is a real possibility this
 * codebase's queue/worker model doesn't rule out, and "someone else already recorded this
 * relation" is not a failure. Verified empirically: better-sqlite3 throws a `Database.SqliteError`
 * with `code` `SQLITE_CONSTRAINT_UNIQUE` (duplicate pair+type) or `SQLITE_CONSTRAINT_CHECK`
 * (inverse pair) — either is caught here; anything else propagates.
 */
export function storeLabeledRelations(
  sqlite: Database.Database,
  labeled: readonly LabeledPair[],
): StoreRelationsResult {
  const insert = sqlite.prepare(
    'INSERT INTO relations (item_a, item_b, type, score, rationale) VALUES (?, ?, ?, ?, ?)',
  )

  const run = sqlite.transaction((rows: readonly LabeledPair[]) => {
    let inserted = 0
    let skipped = 0
    for (const row of rows) {
      try {
        insert.run(
          row.itemA,
          row.itemB,
          row.type,
          similarityFromDistance(row.distance),
          row.rationale,
        )
        inserted++
      } catch (err) {
        if (err instanceof Database.SqliteError && err.code.startsWith('SQLITE_CONSTRAINT')) {
          skipped++
          continue
        }
        throw err
      }
    }
    return { inserted, skipped }
  })

  return run(labeled)
}

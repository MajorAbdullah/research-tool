/**
 * `index` (P7.6) — the pipeline's last stage. FTS5 sync is entirely trigger-driven (see
 * drizzle/0000_init.sql's header) — every prior stage's writes to `items` already kept
 * `items_fts` current, so this stage's "verify" is a real, cheap defensive check (catching a
 * broken trigger loudly instead of silently shipping an unsearchable item — CLAUDE.md's "fail
 * loudly" bar), not busywork. The only state change that actually matters here is the one that
 * makes the item show up on the board: flipping `status` to `inbox`.
 *
 * Named `index-stage.ts`, not `index.ts`, so it doesn't collide with this directory's barrel
 * export (`src/worker/jobs/index.ts`).
 */
import { JobName, ItemStatus } from '@/types/contracts'
import type { IndexJobPayload } from '@/types/contracts'
import type { DbClient } from '@/db/client'
import { getItemById, setItemStatus, assertFtsInSync } from '@/repositories/items'
import { runStage } from './shared'
import type { JobHandler } from '../registry'

export interface IndexHandlerDeps {
  db: DbClient
}

export function createIndexHandler(deps: IndexHandlerDeps): JobHandler<IndexJobPayload> {
  return async (payload) => {
    const item = getItemById(deps.db, payload.itemId)
    if (!item) {
      throw new Error(`index: no item with id ${payload.itemId}`)
    }

    await runStage({ db: deps.db, stage: JobName.Index, itemId: item.id }, async () => {
      assertFtsInSync(deps.db, item.id)
      setItemStatus(deps.db, item.id, ItemStatus.Inbox)
    })
  }
}

import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/db/schema'
import { JobName } from '@/types/contracts'
import { createIndexHandler } from '@/worker/jobs/index-stage'
import { getItemById } from '@/repositories/items'
import { makeTestDb, type TestDb } from '../../helpers/db'
import { makeUser, makeItem } from '../../helpers/factories'

function wrap(rawDb: TestDb) {
  return drizzle(rawDb, { schema })
}

describe('createIndexHandler', () => {
  let rawDb: TestDb
  let db: ReturnType<typeof wrap>

  beforeEach(() => {
    rawDb = makeTestDb()
    makeUser(rawDb, 1)
  })

  it('flips status to inbox once FTS sync is verified', async () => {
    db = wrap(rawDb)
    const itemId = makeItem(rawDb, { status: 'processing', title: 'Zebra Diffusion' })
    const handler = createIndexHandler({ db })

    await handler({ name: JobName.Index, itemId })

    expect(getItemById(db, itemId)?.status).toBe('inbox')
    const { c } = db.$client
      .prepare("select count(*) c from items_fts where items_fts match 'Zebra'")
      .get() as { c: number }
    expect(c).toBe(1)
  })

  it('throws loudly (never silently) if items_fts falls out of sync with items', async () => {
    db = wrap(rawDb)
    // Simulate a fully broken sync trigger chain: drop BOTH the insert and update triggers before
    // creating the item, so it's never added to the tokenized FTS5 index. (Dropping only the
    // insert trigger and leaving the update one in place — which `runStage`'s own
    // `setItemStatus('processing')` fires a moment later — corrupts the whole in-memory database
    // instead of reproducing an "out of sync" state: the update trigger's delete-then-reinsert
    // dance targets a rowid the index never had, and FTS5 rejects that outright. Verified
    // empirically while writing this test.) A bare `SELECT rowid FROM items_fts WHERE rowid = ?`
    // would not catch a genuinely missing row either way (see assertFtsInSync's own doc comment)
    // — only the real integrity-check command does.
    db.$client.exec('drop trigger items_fts_ai')
    db.$client.exec('drop trigger items_fts_au')
    const itemId = makeItem(rawDb, { status: 'processing' })
    const handler = createIndexHandler({ db })

    await expect(handler({ name: JobName.Index, itemId })).rejects.toThrow(/items_fts/)
    // Not silently marked inbox — the defensive check did its job.
    expect(getItemById(db, itemId)?.status).not.toBe('inbox')
  })

  it('throws when the item does not exist', async () => {
    db = wrap(rawDb)
    const handler = createIndexHandler({ db })
    await expect(handler({ name: JobName.Index, itemId: 12345 })).rejects.toThrow(/no item with id/)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/db/schema'
import { setItemTags } from '@/repositories/tags'
import { makeTestDb, type TestDb } from '../../helpers/db'
import { makeUser, makeItem } from '../../helpers/factories'

function wrap(rawDb: TestDb) {
  return drizzle(rawDb, { schema })
}

function tagsOf(rawDb: TestDb, itemId: number): string[] {
  return (
    rawDb
      .prepare(
        `select t.label from tags t join item_tags it on it.tag_id = t.id where it.item_id = ? order by t.label`,
      )
      .all(itemId) as Array<{ label: string }>
  ).map((r) => r.label)
}

function assertFtsIntegrity(rawDb: TestDb): void {
  expect(() =>
    rawDb.exec(`insert into items_fts(items_fts, rank) values ('integrity-check', 1)`),
  ).not.toThrow()
}

describe('setItemTags', () => {
  let rawDb: TestDb
  let db: ReturnType<typeof wrap>
  let itemId: number

  beforeEach(() => {
    rawDb = makeTestDb()
    makeUser(rawDb, 1)
    db = wrap(rawDb)
    itemId = makeItem(rawDb, { id: 1 })
  })

  /**
   * Regression test (P7): `item_tags_fts_ad` (drizzle/0000_init.sql) reconstructs the pre-delete
   * `tags` string for FTS5's delete-command as `<remaining item_tags for this item> || ' ' ||
   * <the just-deleted tag's label>`. SQLite's `||` propagates NULL through the whole expression,
   * so deleting an item's LAST remaining tag reconstructs NULL instead of the real label that was
   * actually indexed — corrupting the external-content FTS5 index ("database disk image is
   * malformed" on the next write). Reproduced with plain SQL against the untouched migration, no
   * P7 code involved. `setItemTags` avoids ever hitting that path by inserting the new tag set
   * before deleting whichever old tags are no longer wanted, so `item_tags` never drops to zero
   * rows for an item that's about to have tags again.
   */
  it('re-assigning the same tags a second time does not corrupt the FTS5 index', () => {
    setItemTags(db, 1, itemId, ['alpha', 'beta', 'gamma'])
    assertFtsIntegrity(rawDb)

    setItemTags(db, 1, itemId, ['alpha', 'beta', 'gamma'])
    assertFtsIntegrity(rawDb)

    expect(tagsOf(rawDb, itemId)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('re-assigning a fully different tag set does not corrupt the FTS5 index', () => {
    setItemTags(db, 1, itemId, ['alpha'])
    assertFtsIntegrity(rawDb)

    setItemTags(db, 1, itemId, ['zeta', 'eta'])
    assertFtsIntegrity(rawDb)

    expect(tagsOf(rawDb, itemId)).toEqual(['eta', 'zeta'])
  })

  it('three consecutive re-assignments in a row stay consistent', () => {
    setItemTags(db, 1, itemId, ['one', 'two'])
    setItemTags(db, 1, itemId, ['one', 'two'])
    setItemTags(db, 1, itemId, ['one', 'two'])
    assertFtsIntegrity(rawDb)
    expect(tagsOf(rawDb, itemId)).toEqual(['one', 'two'])
  })

  it('keeps a tag shared across items intact when removed from only one of them', () => {
    const otherItemId = makeItem(rawDb, { id: 2 })
    setItemTags(db, 1, itemId, ['shared'])
    setItemTags(db, 1, otherItemId, ['shared'])

    setItemTags(db, 1, itemId, ['different'])
    assertFtsIntegrity(rawDb)

    expect(tagsOf(rawDb, itemId)).toEqual(['different'])
    expect(tagsOf(rawDb, otherItemId)).toEqual(['shared'])
  })

  it('does not touch item_tags rows for tags that are unchanged between calls', () => {
    setItemTags(db, 1, itemId, ['keep-me', 'drop-me'])
    const before = rawDb
      .prepare(
        'select rowid from item_tags where item_id = ? and tag_id = (select id from tags where label = ?)',
      )
      .get(itemId, 'keep-me') as { rowid: number }

    setItemTags(db, 1, itemId, ['keep-me', 'new-tag'])
    const after = rawDb
      .prepare(
        'select rowid from item_tags where item_id = ? and tag_id = (select id from tags where label = ?)',
      )
      .get(itemId, 'keep-me') as { rowid: number }

    expect(after.rowid).toBe(before.rowid) // same underlying row — never deleted and reinserted
    expect(tagsOf(rawDb, itemId)).toEqual(['keep-me', 'new-tag'])
  })
})

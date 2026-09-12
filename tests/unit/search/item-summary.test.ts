import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { loadItemSummaryRows, toItemWireId } from '@/lib/search/item-summary'
import { makeTestDb, type TestDb } from '../../helpers/db'
import { makeUser, makeItem, tagItem } from '../../helpers/factories'

describe('toItemWireId', () => {
  it('prefixes with itm_', () => {
    expect(toItemWireId(42)).toBe('itm_42')
  })
})

describe('loadItemSummaryRows', () => {
  let db: TestDb
  beforeEach(() => {
    db = makeTestDb()
    makeUser(db, 1)
  })
  afterEach(() => db.close())

  it('returns an empty map for an empty id list', () => {
    expect(loadItemSummaryRows(db, [], 1)).toEqual(new Map())
  })

  it('maps core fields and the wire id', () => {
    makeItem(db, { id: 1, title: 'A Title', tldr: 'tldr text', kind: 'video' })
    const rows = loadItemSummaryRows(db, [1], 1)
    const row = rows.get(1)
    expect(row).toBeDefined()
    expect(row?.id).toBe('itm_1')
    expect(row?.title).toBe('A Title')
    expect(row?.summary_tldr).toBe('tldr text')
    expect(row?.kind).toBe('video')
  })

  it('aggregates tags without N+1 queries', () => {
    const id = makeItem(db, { id: 1 })
    tagItem(db, id, 'diffusion')
    tagItem(db, id, 'fine-tuning')
    const row = loadItemSummaryRows(db, [1], 1).get(1)
    expect(row?.tags.sort()).toEqual(['diffusion', 'fine-tuning'])
  })

  it('has an empty tags array when the item has none', () => {
    makeItem(db, { id: 1 })
    expect(loadItemSummaryRows(db, [1], 1).get(1)?.tags).toEqual([])
  })

  it('picks the highest-confidence topic as primary, falling back a default color when unset', () => {
    makeItem(db, { id: 1 })
    db.prepare(
      "insert into topics (id, user_id, slug, label, color) values (1,1,'low','Low Conf',NULL)",
    ).run()
    db.prepare(
      "insert into topics (id, user_id, slug, label, color) values (2,1,'high','High Conf','#123456')",
    ).run()
    db.prepare('insert into item_topics (item_id, topic_id, confidence) values (1,1,0.4)').run()
    db.prepare('insert into item_topics (item_id, topic_id, confidence) values (1,2,0.9)').run()

    const row = loadItemSummaryRows(db, [1], 1).get(1)
    expect(row?.topic).toEqual({
      slug: 'high',
      label: 'High Conf',
      color: '#123456',
      confidence: 0.9,
    })
  })

  it('falls back to a default color when the chosen topic has none set', () => {
    makeItem(db, { id: 1 })
    db.prepare(
      "insert into topics (id, user_id, slug, label, color) values (1,1,'t','T',NULL)",
    ).run()
    db.prepare('insert into item_topics (item_id, topic_id, confidence) values (1,1,0.9)').run()
    const row = loadItemSummaryRows(db, [1], 1).get(1)
    expect(row?.topic?.color).toBe('#6b7280')
  })

  it('has a null topic when the item has none assigned', () => {
    makeItem(db, { id: 1 })
    expect(loadItemSummaryRows(db, [1], 1).get(1)?.topic).toBeNull()
  })

  it('is scoped by userId even if a foreign id sneaks into the requested list', () => {
    makeUser(db, 2)
    makeItem(db, { id: 1, userId: 2 })
    expect(loadItemSummaryRows(db, [1], 1).get(1)).toBeUndefined()
  })

  it('converts the starred integer column to a boolean', () => {
    makeItem(db, { id: 1 })
    db.prepare('update items set starred = 1 where id = 1').run()
    expect(loadItemSummaryRows(db, [1], 1).get(1)?.starred).toBe(true)
  })
})

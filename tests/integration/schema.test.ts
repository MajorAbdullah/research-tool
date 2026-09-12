import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { makeTestDb, fakeEmbedding, EMBEDDING_DIMS, type TestDb } from '../helpers/db'
import { makeUser, makeItem, makeChunk, tagItem } from '../helpers/factories'

/**
 * Regression tests for the three SQLite behaviours that were discovered empirically
 * during P0 and are documented as hard rules in CLAUDE.md. Each of these was a real
 * bug, not a hypothetical — they are pinned here so nobody "simplifies" them back.
 */
describe('schema + migration', () => {
  let db: TestDb
  beforeEach(() => {
    db = makeTestDb()
    makeUser(db, 1)
  })
  afterEach(() => db.close())

  it('applies the migration and creates both virtual tables', () => {
    const names = (
      db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]
    ).map((r) => r.name)
    expect(names).toContain('items_fts')
    expect(names).toContain('chunk_vec')
  })

  it('is idempotent — re-applying the migration does not throw or duplicate tables', () => {
    // makeTestDb() already applied it once; apply the same file again on the same handle.
    const before = (
      db.prepare("select count(*) c from sqlite_master where type = 'table'").get() as { c: number }
    ).c

    expect(() => db.exec(readFileSync('drizzle/0000_init.sql', 'utf8'))).not.toThrow()

    const after = (
      db.prepare("select count(*) c from sqlite_master where type = 'table'").get() as { c: number }
    ).c
    expect(after).toBe(before)

    // and the data still works afterwards
    makeItem(db, { id: 999, title: 'Idempotent Giraffe' })
    const { c } = db
      .prepare("select count(*) c from items_fts where items_fts match 'Giraffe'")
      .get() as { c: number }
    expect(c).toBe(1)
  })

  describe('FTS5 sync', () => {
    it('indexes an item on insert', () => {
      makeItem(db, { id: 1, title: 'Zebra Diffusion', tldr: 'a repo about zebras' })
      const { c } = db
        .prepare("select count(*) c from items_fts where items_fts match 'zebra'")
        .get() as { c: number }
      expect(c).toBe(1)
    })

    /**
     * The load-bearing one. SQLite processes ON DELETE CASCADE to item_tags *between* a
     * row's BEFORE and AFTER triggers, so an AFTER DELETE sync trigger reads an already
     * empty tag set and leaves a stale FTS row that still matches searches for a deleted
     * item. The trigger must be BEFORE DELETE.
     */
    it('leaves NO stale FTS row after an item is deleted', () => {
      const id = makeItem(db, { id: 2, title: 'Zebra Diffusion', tldr: 'about zebras' })
      tagItem(db, id, 'quantization')
      db.prepare('delete from items where id = ?').run(id)

      const { c } = db
        .prepare("select count(*) c from items_fts where items_fts match 'zebra'")
        .get() as { c: number }
      expect(c).toBe(0)
    })

    it('makes tags searchable through the synthesized view', () => {
      const id = makeItem(db, { id: 3, title: 'Some Repo' })
      tagItem(db, id, 'quantization')
      const { c } = db
        .prepare("select count(*) c from items_fts where items_fts match 'quantization'")
        .get() as { c: number }
      expect(c).toBe(1)
    })

    it('reflects an updated title', () => {
      const id = makeItem(db, { id: 4, title: 'Before Title' })
      db.prepare('update items set title = ?, updated_at = ? where id = ?').run(
        'After Elephant',
        Date.now(),
        id,
      )
      const before = db
        .prepare("select count(*) c from items_fts where items_fts match 'Before'")
        .get() as { c: number }
      const after = db
        .prepare("select count(*) c from items_fts where items_fts match 'Elephant'")
        .get() as { c: number }
      expect(before.c).toBe(0)
      expect(after.c).toBe(1)
    })
  })

  describe('relations constraints', () => {
    beforeEach(() => {
      makeItem(db, { id: 10 })
      makeItem(db, { id: 11 })
    })

    it('rejects an inverse pair so a relation is stored exactly once', () => {
      db.prepare('insert into relations (item_a, item_b, type, score) values (?,?,?,?)').run(
        10,
        11,
        'alternative',
        0.9,
      )
      expect(() =>
        db
          .prepare('insert into relations (item_a, item_b, type, score) values (?,?,?,?)')
          .run(11, 10, 'alternative', 0.9),
      ).toThrow()
    })

    it('rejects a duplicate of the same pair and type', () => {
      db.prepare('insert into relations (item_a, item_b, type, score) values (?,?,?,?)').run(
        10,
        11,
        'similar',
        0.5,
      )
      expect(() =>
        db
          .prepare('insert into relations (item_a, item_b, type, score) values (?,?,?,?)')
          .run(10, 11, 'similar', 0.7),
      ).toThrow()
    })
  })

  describe('chunk_vec (sqlite-vec)', () => {
    it('rejects a plain JS number as a rowid but accepts a BigInt', () => {
      const emb = fakeEmbedding()
      expect(() =>
        db.prepare('insert into chunk_vec (rowid, embedding) values (?,?)').run(9001, emb),
      ).toThrow(/integer/i)
      expect(() =>
        db.prepare('insert into chunk_vec (rowid, embedding) values (?,?)').run(9001n, emb),
      ).not.toThrow()
    })

    it('stores vectors at exactly 384 dimensions', () => {
      const itemId = makeItem(db, { id: 20 })
      makeChunk(db, itemId, 'hello world')
      const row = db.prepare('select vec_length(embedding) n from chunk_vec limit 1').get() as {
        n: number
      }
      expect(row.n).toBe(EMBEDDING_DIMS)
    })

    /**
     * Access control must be a PRE-filter on the kNN, not a post-hoc discard.
     * See CLAUDE.md → RAG and the retrieval-layer rule.
     */
    it('scopes kNN results by user_id as a pre-filter', () => {
      makeUser(db, 2)
      const mine = makeItem(db, { id: 30, userId: 1 })
      const theirs = makeItem(db, { id: 31, userId: 2 })
      makeChunk(db, mine, 'my private note', { userId: 1, seed: 1 })
      makeChunk(db, theirs, 'their private note', { userId: 2, seed: 1 })

      const rows = db
        .prepare(
          `select c.id, c.user_id
             from chunk_vec v
             join chunks c on c.id = v.rowid
            where v.embedding match ? and k = 10 and c.user_id = ?`,
        )
        .all(fakeEmbedding(1), 1) as { id: number; user_id: number }[]

      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((r) => r.user_id === 1)).toBe(true)
    })
  })

  describe('item invariants', () => {
    it('enforces url_hash uniqueness per user', () => {
      makeItem(db, { id: 40, url: 'https://example.test/dup' })
      expect(() =>
        db
          .prepare(
            `insert into items (id,user_id,url,canonical_url,url_hash,kind,status,
               extraction_tier,source_surface,created_at,updated_at)
             values (41,1,'https://example.test/dup','https://example.test/dup','hash-40',
               'github','inbox','full','extension',?,?)`,
          )
          .run(Date.now(), Date.now()),
      ).toThrow()
    })

    it('rejects an unknown kind and an unknown status', () => {
      expect(() => makeItem(db, { id: 50, kind: 'not-a-kind' })).toThrow()
      expect(() => makeItem(db, { id: 51, status: 'not-a-status' })).toThrow()
    })

    it('rejects an unknown extraction_tier', () => {
      expect(() => makeItem(db, { id: 52, extractionTier: 'mostly' })).toThrow()
    })
  })
})

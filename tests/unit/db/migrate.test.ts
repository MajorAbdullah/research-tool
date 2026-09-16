import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { load as loadSqliteVec } from 'sqlite-vec'
import {
  applyMigrationSql,
  runMigrations,
  readChunkVecDimensions,
  reconcileChunkVecDimensions,
} from '@/db/migrate'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_SQL = readFileSync(path.join(process.cwd(), 'drizzle', '0000_init.sql'), 'utf8')

function freshConnection(): Database.Database {
  const db = new Database(':memory:')
  loadSqliteVec(db) // required before running the migration — it creates chunk_vec USING vec0
  return db
}

describe('runMigrations / applyMigrationSql', () => {
  it('creates every relational table, the FTS5 index, and the vec0 virtual table', () => {
    const db = freshConnection()
    applyMigrationSql(db, MIGRATION_SQL)

    const tableNames = new Set(
      db
        .prepare<[], { name: string }>(
          `SELECT name FROM sqlite_master WHERE type IN ('table', 'view')`,
        )
        .all()
        .map((row) => row.name),
    )

    for (const expected of [
      'users',
      'items',
      'topics',
      'item_topics',
      'tags',
      'item_tags',
      'chunks',
      'relations',
      'jobs',
      'llm_calls',
      'settings',
      'items_fts_source',
      'items_fts',
      'chunk_vec',
    ]) {
      expect(tableNames.has(expected)).toBe(true)
    }
  })

  it('is idempotent — running it twice against the same database is a clean no-op', () => {
    const db = freshConnection()
    applyMigrationSql(db, MIGRATION_SQL)

    // The whole point under test: a second run must not throw ("table already exists", "trigger
    // already exists", etc.) — every statement in the file relies on IF NOT EXISTS for this.
    expect(() => applyMigrationSql(db, MIGRATION_SQL)).not.toThrow()

    // And it didn't just silently swallow an error — the schema is still fully intact afterwards.
    const usersColumns = db.prepare(`PRAGMA table_info(users)`).all()
    expect(usersColumns.length).toBeGreaterThan(0)
  })

  it('runMigrations reads the real drizzle/0000_init.sql file and applies it', () => {
    const db = freshConnection()
    runMigrations(db)

    const row = db.prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM jobs`).get()
    expect(row?.count).toBe(0) // table exists and is queryable, just empty on a fresh DB
  })
})

describe('reconcileChunkVecDimensions', () => {
  it('reads the width back out of the stored CREATE statement', () => {
    const db = freshConnection()
    applyMigrationSql(db, MIGRATION_SQL)
    // 0000_init.sql hardcodes bge-small's 384 (ADR 0003's "fixed, literal 384-dim column").
    expect(readChunkVecDimensions(db)).toBe(384)
  })

  it('rebuilds an EMPTY chunk_vec at the configured width', () => {
    // Switching EMBEDDING_PROVIDER to a 2048-d hosted model on a database with no vectors yet
    // must just work — a vec0 table's width is fixed at CREATE and cannot be ALTERed, so the
    // only way to change it is to recreate it.
    const db = freshConnection()
    applyMigrationSql(db, MIGRATION_SQL)

    reconcileChunkVecDimensions(db, 2048)

    expect(readChunkVecDimensions(db)).toBe(2048)
  })

  it('is a no-op when the width already matches', () => {
    const db = freshConnection()
    applyMigrationSql(db, MIGRATION_SQL)
    reconcileChunkVecDimensions(db, 384)
    expect(readChunkVecDimensions(db)).toBe(384)
  })

  it('REFUSES to rebuild a populated chunk_vec, rather than deleting the index', () => {
    // The dangerous case. Recreating the table here would silently destroy every stored vector
    // as a side effect of an .env edit, and on a hosted provider rebuilding costs real request
    // budget. It must fail loudly and name the remedy instead.
    const db = freshConnection()
    applyMigrationSql(db, MIGRATION_SQL)
    db.prepare('INSERT INTO chunk_vec (rowid, embedding) VALUES (?, ?)').run(
      BigInt(1),
      JSON.stringify(new Array(384).fill(0.1)),
    )

    expect(() => reconcileChunkVecDimensions(db, 2048)).toThrow(/already holds vectors/)
    expect(() => reconcileChunkVecDimensions(db, 2048)).toThrow(/pnpm reembed/)

    // and the existing index is still intact
    expect(readChunkVecDimensions(db)).toBe(384)
    expect((db.prepare('SELECT COUNT(*) AS n FROM chunk_vec').get() as { n: number }).n).toBe(1)
  })
})

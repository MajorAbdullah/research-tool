import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { load as loadSqliteVec } from 'sqlite-vec'
import { applyMigrationSql, runMigrations } from '@/db/migrate'
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

/**
 * Shared test helper — NOT a test file itself (no `.test.ts` suffix, so vitest's glob ignores
 * it). Builds a fully-migrated, in-memory SQLite database so unit tests never touch a real file
 * on disk or the app's configured `SQLITE_PATH`.
 */
import Database from 'better-sqlite3'
import { load as loadSqliteVec } from 'sqlite-vec'
import { runMigrations } from '@/db/migrate'

export function createScratchDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  // The migration's chunk_vec table is `USING vec0(...)` — the extension must be loaded before
  // the migration SQL runs, or `CREATE VIRTUAL TABLE` fails with "no such module: vec0".
  loadSqliteVec(db)
  runMigrations(db)
  return db
}

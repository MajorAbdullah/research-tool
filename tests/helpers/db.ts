import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type TestDb = Database.Database

const MIGRATION = readFileSync(join(process.cwd(), 'drizzle/0000_init.sql'), 'utf8')

/**
 * An in-memory database with the real migration applied and sqlite-vec loaded.
 *
 * Deliberately runs the *actual* `drizzle/0000_init.sql` rather than a hand-maintained
 * test schema: the FTS5 triggers and the vec0 table are where the subtle bugs live, so a
 * divergent test schema would hide exactly the failures these tests exist to catch.
 */
export function makeTestDb(): TestDb {
  const db = new Database(':memory:')
  sqliteVec.load(db)
  db.pragma('foreign_keys = ON')
  db.exec(MIGRATION)
  return db
}

/** 384 — bge-small-en-v1.5. Fixed, and asserted in the integration suite. */
export const EMBEDDING_DIMS = 384

/** A deterministic unit-ish vector, so similarity assertions are reproducible. */
export function fakeEmbedding(seed = 1): Float32Array {
  const v = new Float32Array(EMBEDDING_DIMS)
  for (let i = 0; i < EMBEDDING_DIMS; i++) v[i] = Math.sin((i + 1) * seed) * 0.05
  return v
}

/**
 * Boot-time migration runner.
 *
 * Executes `drizzle/0000_init.sql` directly against a live connection — NOT drizzle-kit's own
 * `migrate()`/journal mechanism. That file is a hand-edited migration (FTS5 + sqlite-vec +
 * triggers, per its own header comment) with no `drizzle/meta/_journal.json` alongside it, so
 * drizzle-kit's bookkeeping table approach doesn't apply here. Idempotent by construction: every
 * statement in the file uses `IF NOT EXISTS` (or `CREATE TRIGGER IF NOT EXISTS`), so re-running
 * the whole script against an already-migrated database is a safe no-op — see
 * `tests/unit/db/migrate.test.ts`, which asserts this by running it twice.
 *
 * Must run before the worker loop starts (see `instrumentation.ts`) — the worker's first claim
 * query would otherwise hit "no such table: jobs".
 *
 * Whatever connection you pass in must already have the sqlite-vec extension loaded (see
 * `src/db/client.ts`'s `getSqlite()`) — the migration's `chunk_vec` table is `CREATE VIRTUAL
 * TABLE ... USING vec0(...)`, and without the extension loaded first that fails with "no such
 * module: vec0" rather than anything obviously pointing at a missing `loadExtension` call.
 */

import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { getSqlite } from './client'
import { getConfig } from '@/lib/config'
import { logger } from '@/lib/logger'

// Relative to the process cwd, matching drizzle.config.ts's own `out: './drizzle'` convention —
// both `pnpm db:migrate` (tsx) and the Next server run with cwd at the repo root.
const MIGRATION_FILE = path.join(process.cwd(), 'drizzle', '0000_init.sql')

/**
 * Applies a migration SQL string to `sqlite`. Split out from `runMigrations` (which reads the
 * file from disk) purely so tests can exercise the idempotency guarantee against arbitrary SQL
 * text without needing a real file on disk.
 */
export function applyMigrationSql(sqlite: Database.Database, sql: string): void {
  sqlite.exec(sql)
}

/**
 * Reads `drizzle/0000_init.sql` and applies it. Defaults to the shared connection
 * (`getSqlite()`), but accepts an explicit connection so tests can migrate a scratch/in-memory
 * database instead of touching the app's real configured `SQLITE_PATH`.
 */
export function runMigrations(sqlite: Database.Database = getSqlite()): void {
  const sql = fs.readFileSync(MIGRATION_FILE, 'utf8')
  applyMigrationSql(sqlite, sql)
  logger.info({ file: MIGRATION_FILE }, 'db: migrations applied')
  reconcileChunkVecDimensions(sqlite, getConfig().embeddingDimensions)
}

/** Reads the width out of chunk_vec's stored CREATE statement, e.g. `... float[384])` -> 384. */
export function readChunkVecDimensions(sqlite: Database.Database): number | null {
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chunk_vec'")
    .get() as { sql: string | null } | undefined
  const match = row?.sql?.match(/float\s*\[\s*(\d+)\s*\]/i)
  return match?.[1] ? Number(match[1]) : null
}

/**
 * Makes `chunk_vec`'s column width match the configured embedding dimension.
 *
 * `0000_init.sql` hardcodes `float[384]`, which was correct while the local model was the only
 * supported one (ADR 0003: "a fixed, literal 384-dim column"). The dimension is now a deployment
 * choice — OpenRouter's free embedding models return 2048 — and a vec0 virtual table's width is
 * fixed at CREATE and cannot be ALTERed, so the table has to be recreated to change it.
 *
 * Dropping is safe only while the table is empty: `chunk_vec` is derived data, rebuildable from
 * `chunks` by `pnpm reembed`, but rebuilding costs a full re-embed pass and (on a hosted provider)
 * real request budget. So an empty mismatched table is silently corrected, and a POPULATED
 * mismatched one refuses to boot — the alternative is deleting someone's whole index as a side
 * effect of an env edit.
 */
export function reconcileChunkVecDimensions(sqlite: Database.Database, dimensions: number): void {
  const actual = readChunkVecDimensions(sqlite)
  if (actual === null || actual === dimensions) return

  const populated =
    (sqlite.prepare('SELECT COUNT(*) AS n FROM chunk_vec').get() as { n: number }).n > 0

  if (populated) {
    throw new Error(
      `chunk_vec is ${actual}-d but EMBEDDING_DIMENSIONS is ${dimensions}, and it already holds ` +
        `vectors. Vectors from different models aren't comparable, so this will not be changed ` +
        `automatically — that would silently delete the whole index. Run 'pnpm reembed' to ` +
        `rebuild it at ${dimensions}-d with the configured model, or put EMBEDDING_DIMENSIONS ` +
        `back to ${actual}.`,
    )
  }

  sqlite.exec('DROP TABLE IF EXISTS chunk_vec')
  sqlite.exec(`CREATE VIRTUAL TABLE chunk_vec USING vec0(embedding float[${dimensions}])`)
  logger.info({ from: actual, to: dimensions }, 'db: rebuilt empty chunk_vec at configured width')
}

// CLI entry point — `pnpm db:migrate` runs `tsx src/db/migrate.ts` directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
}

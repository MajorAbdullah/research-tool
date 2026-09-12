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
 */

import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { getSqlite } from './client'
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
}

// CLI entry point — `pnpm db:migrate` runs `tsx src/db/migrate.ts` directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
}

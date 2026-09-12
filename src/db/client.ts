/**
 * Shared SQLite connection — WAL mode, `busy_timeout`, foreign keys, sqlite-vec loaded.
 *
 * Single module-scoped connection (better-sqlite3 is synchronous; this codebase never pools —
 * see docs/adr/0001-sqlite-over-postgres.md). Guarded on `globalThis` rather than a plain
 * module-level variable: Next.js's dev server hot-reloads route/module code by re-evaluating
 * modules, which would otherwise open a second connection to the same WAL file on every
 * edit-triggered reload and eventually surface as "database is locked". `globalThis` survives
 * module-cache invalidation because it's a true process global, not part of the ES module
 * registry Next.js clears on reload.
 *
 * `sqlite-vec` is loaded eagerly, right here, rather than lazily on first search — per
 * CLAUDE.md, search breaks *silently* without it (no error, just kNN queries against a virtual
 * table that was never created), so the failure mode we want is "boot fails loudly" instead.
 */

import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { load as loadSqliteVec } from 'sqlite-vec'
import { getConfig } from '@/lib/config'
import { logger } from '@/lib/logger'
import * as schema from './schema'

declare global {
  // `var` (not let/const) is required here — TS only merges global augmentations declared this
  // way. This is a type-only ambient declaration; it has no runtime effect of its own.
  // eslint-disable-next-line no-var
  var __sieveSqlite: Database.Database | undefined
}

function openConnection(sqlitePath: string): Database.Database {
  const dir = path.dirname(sqlitePath)
  if (dir !== '' && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const connection = new Database(sqlitePath)
  connection.pragma('journal_mode = WAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('foreign_keys = ON')
  loadSqliteVec(connection)

  logger.info({ sqlitePath }, 'sqlite: connection opened (WAL, sqlite-vec loaded)')
  return connection
}

/**
 * The single shared better-sqlite3 connection. Safe to call repeatedly, including across a Next
 * dev hot-reload — creates the connection once, then always returns that same instance.
 */
export function getSqlite(): Database.Database {
  if (!globalThis.__sieveSqlite) {
    globalThis.__sieveSqlite = openConnection(getConfig().sqlitePath)
  }
  return globalThis.__sieveSqlite
}

function createDbClient(sqlite: Database.Database) {
  return drizzle(sqlite, { schema })
}

export type DbClient = ReturnType<typeof createDbClient>

let cachedDb: DbClient | undefined

/**
 * Drizzle query-builder wrapper over `getSqlite()`. Deliberately a plain module-level cache
 * (not `globalThis`) — unlike the raw connection, this holds no OS resource of its own, so
 * recreating it after a hot-reload is cheap and leaks nothing; it always wraps whichever
 * connection `getSqlite()` returns.
 */
export function getDb(): DbClient {
  if (!cachedDb) {
    cachedDb = createDbClient(getSqlite())
  }
  return cachedDb
}

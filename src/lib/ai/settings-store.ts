/**
 * Persistence seam for the `settings` key-value table (schema frozen in `src/db/schema.ts`).
 *
 * P3 is not allowed to create `src/db/**` — `src/db/client.ts` (the actual `better-sqlite3`
 * connection: WAL, `busy_timeout`, `sqlite-vec` loaded) is P1's file (P1.2.1). Rather than import
 * a client module that doesn't exist yet from this phase's worktree, `BudgetManager` and
 * `LlmCallLog` depend on the small structural port below. A real `better-sqlite3.Database`
 * instance already satisfies it (it has exactly this `.prepare()` shape) with zero adapter code
 * needed beyond what's here — whoever wires the app together passes P1's real connection into
 * `createSqliteSettingsPort(realDb)`; nothing here hardcodes a vendor import.
 */

export interface PreparedStatementLike {
  get(...params: unknown[]): unknown
  run(...params: unknown[]): unknown
}

/** The minimal slice of `better-sqlite3.Database` (and of Drizzle's underlying handle) this
 *  module needs. Structural, not nominal — no import of the `better-sqlite3` package required. */
export interface SqliteLike {
  prepare(sql: string): PreparedStatementLike
}

export interface SettingsPort {
  get(key: string): string | undefined
  set(key: string, value: string): void
}

interface SettingsRow {
  value: string
}

/**
 * Adapter over the real `settings` table: `CREATE TABLE settings (key TEXT PRIMARY KEY, value
 * TEXT NOT NULL)` — see drizzle/0000_init.sql. `INSERT ... ON CONFLICT DO UPDATE` keeps the write
 * a single parameterized statement (CLAUDE.md: "always use parameterized queries").
 */
export function createSqliteSettingsPort(db: SqliteLike): SettingsPort {
  const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?')
  const setStmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
  return {
    get(key: string): string | undefined {
      const row = getStmt.get(key) as SettingsRow | undefined
      return row?.value
    },
    set(key: string, value: string): void {
      setStmt.run(key, value)
    },
  }
}

/** In-memory `SettingsPort` for unit tests — no real SQLite involved, nothing touches the network
 *  or the filesystem. */
export function createInMemorySettingsPort(seed: Record<string, string> = {}): SettingsPort {
  const store = new Map(Object.entries(seed))
  return {
    get(key) {
      return store.get(key)
    },
    set(key, value) {
      store.set(key, value)
    },
  }
}

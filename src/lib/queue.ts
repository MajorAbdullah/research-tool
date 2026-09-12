/**
 * The `jobs` table queue: enqueue, atomically claim, complete, fail-with-backoff.
 *
 * The subtle part is `claimNext`. SQLite has no `SELECT ... FOR UPDATE SKIP LOCKED` — the
 * standard Postgres-style "hand me a job nobody else has" primitive doesn't exist here. Two
 * separate statements (`SELECT ... WHERE state='queued' LIMIT 1` then `UPDATE ... WHERE id=?`)
 * would race: two callers could both SELECT the same queued row before either UPDATEs it, and
 * both would then believe they own it. The fix is a single statement — an `UPDATE ... WHERE id =
 * (SELECT ...) RETURNING *` — so there is no gap between "pick a row" and "mark it claimed" for
 * anything else to land in. See `tests/unit/queue/concurrent-claim.test.ts` for a test that
 * proves this empirically (multiple real OS processes hammering the same on-disk database),
 * rather than trusting that it merely "looks atomic" from reading the SQL.
 */

import type Database from 'better-sqlite3'
import { JobName } from '@/types/contracts'
import type { JobPayload, JobState, UtcMillis } from '@/types/contracts'
import { getSqlite } from '@/db/client'

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

export interface JobRow {
  id: number
  name: JobName
  payload: JobPayload
  state: JobState
  attempts: number
  runAt: UtcMillis
  lastError: string | null
}

/** The `jobs` table's on-disk column shapes, before parsing into `JobRow`. */
interface RawJobRow {
  id: number
  name: string
  payload: string
  state: string
  attempts: number
  run_at: number
  last_error: string | null
}

const JOB_NAMES: readonly string[] = Object.values(JobName)

function isJobPayload(value: unknown): value is JobPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof (value as { name: unknown }).name === 'string' &&
    JOB_NAMES.includes((value as { name: string }).name)
  )
}

/**
 * Converts a raw DB row into a `JobRow`. `name`/`state` are trusted as-is — the `jobs_name_check`
 * / `jobs_state_check` CHECK constraints in the migration already guarantee they're one of the
 * known enum values, so re-validating them here would just duplicate the DB's own constraint.
 * `payload` gets a real runtime check: SQLite has no way to CHECK-constrain nested JSON shape, so
 * this is the one place a corrupt or hand-edited row could otherwise slip an arbitrary object
 * past the type system.
 */
function parseRow(row: RawJobRow): JobRow {
  const payload: unknown = JSON.parse(row.payload)
  if (!isJobPayload(payload)) {
    throw new Error(`jobs row ${row.id}: payload does not look like a JobPayload`)
  }
  return {
    id: row.id,
    name: row.name as JobName,
    payload,
    state: row.state as JobState,
    attempts: row.attempts,
    runAt: row.run_at,
    lastError: row.last_error,
  }
}

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_ATTEMPTS = 5
export const DEFAULT_BASE_DELAY_MS = 1_000
export const DEFAULT_MAX_DELAY_MS = 15 * 60_000 // 15 minutes

export interface BackoffOptions {
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

/** Pure exponential backoff: `baseDelayMs * 2^(attempts-1)`, capped at `maxDelayMs`. */
export function computeBackoffMs(attempts: number, options: BackoffOptions = {}): number {
  const base = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const max = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const exponent = Math.max(0, attempts - 1)
  return Math.min(base * 2 ** exponent, max)
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export interface EnqueueOptions {
  /** Defaults to now — set in the future to delay a job (used by `fail`'s backoff). */
  runAt?: UtcMillis
}

export interface JobQueue {
  /** Typed against the `JobPayload` discriminated union — enqueuing an invalid shape is a type error. */
  enqueue(payload: JobPayload, options?: EnqueueOptions): JobRow
  /** Atomically claims the oldest due `queued` job, or `null` if none is due. */
  claimNext(now?: UtcMillis): JobRow | null
  /** Marks a claimed job done. */
  complete(id: number): JobRow
  /**
   * Marks a claimed job's attempt as failed. Reschedules with exponential backoff while under
   * `maxAttempts`; moves to `failed` with `lastError` once attempts are exhausted.
   * `humanReadableError` becomes `items.failure_reason` territory once P7 wires this up to items
   * — pass a message a user could read, not a raw stack trace (see CLAUDE.md's error-shape rule).
   */
  fail(id: number, humanReadableError: string, options?: BackoffOptions): JobRow
}

const ENQUEUE_SQL = `INSERT INTO jobs (name, payload, run_at) VALUES (?, ?, ?) RETURNING *`

// The atomic claim: one statement, no gap between "pick a row" and "mark it claimed". Wrapped in
// an explicit transaction (see `createJobQueue` below) even though a single statement is already
// atomic on its own — the transaction is what makes better-sqlite3 retry under `busy_timeout`
// consistently and documents the intent for the next reader.
const CLAIM_SQL = `
  UPDATE jobs
  SET state = 'active', attempts = attempts + 1
  WHERE id = (SELECT id FROM jobs WHERE state = 'queued' AND run_at <= ? ORDER BY run_at LIMIT 1)
  RETURNING *
`

const COMPLETE_SQL = `UPDATE jobs SET state = 'completed' WHERE id = ? RETURNING *`

const GET_BY_ID_SQL = `SELECT * FROM jobs WHERE id = ?`

const RESCHEDULE_SQL = `UPDATE jobs SET state = 'queued', run_at = ?, last_error = ? WHERE id = ? RETURNING *`

const FAIL_PERMANENTLY_SQL = `UPDATE jobs SET state = 'failed', last_error = ? WHERE id = ? RETURNING *`

/**
 * Builds a `JobQueue` bound to the given connection. Exported (rather than only exposing a
 * pre-built singleton) so tests can pass a scratch/in-memory database instead of the app's real
 * configured one — see `tests/unit/queue/*.test.ts`.
 */
export function createJobQueue(sqlite: Database.Database): JobQueue {
  const enqueueStmt = sqlite.prepare<[string, string, number], RawJobRow>(ENQUEUE_SQL)
  const claimStmt = sqlite.prepare<[number], RawJobRow>(CLAIM_SQL)
  const completeStmt = sqlite.prepare<[number], RawJobRow>(COMPLETE_SQL)
  const getByIdStmt = sqlite.prepare<[number], RawJobRow>(GET_BY_ID_SQL)
  const rescheduleStmt = sqlite.prepare<[number, string, number], RawJobRow>(RESCHEDULE_SQL)
  const failPermanentlyStmt = sqlite.prepare<[string, number], RawJobRow>(FAIL_PERMANENTLY_SQL)

  // Transactional wrapper around the claim so the "find a row" + "mark it active" pair commits
  // or rolls back as one unit under better-sqlite3's own locking — belt-and-suspenders on top of
  // RETURNING already making it a single statement.
  const claimTx = sqlite.transaction((now: number): RawJobRow | undefined => claimStmt.get(now))

  return {
    enqueue(payload, options) {
      const runAt = options?.runAt ?? Date.now()
      const row = enqueueStmt.get(payload.name, JSON.stringify(payload), runAt)
      if (!row) throw new Error('enqueue: INSERT ... RETURNING produced no row')
      return parseRow(row)
    },

    claimNext(now = Date.now()) {
      const row = claimTx(now)
      return row ? parseRow(row) : null
    },

    complete(id) {
      const row = completeStmt.get(id)
      if (!row) throw new Error(`complete: no job with id ${id}`)
      return parseRow(row)
    },

    fail(id, humanReadableError, options) {
      // Two statements here are safe (unlike claimNext): by the time anything calls fail(id),
      // that job was already atomically transitioned to 'active' by claimNext, so no other
      // caller can be concurrently racing on this *specific* id — the contested set was "any
      // queued row", not "this exact row", and that contest is already resolved.
      const current = getByIdStmt.get(id)
      if (!current) throw new Error(`fail: no job with id ${id}`)

      const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
      const exhausted = current.attempts >= maxAttempts

      const row = exhausted
        ? failPermanentlyStmt.get(humanReadableError, id)
        : rescheduleStmt.get(Date.now() + computeBackoffMs(current.attempts, options), humanReadableError, id)

      if (!row) throw new Error(`fail: update produced no row for id ${id}`)
      return parseRow(row)
    },
  }
}

let singleton: JobQueue | undefined

/**
 * The app-wide job queue, bound to the shared connection (`getSqlite()`). Lazily created on
 * first call — importing this module never opens a database connection by itself, only calling
 * this function does, so tests that only use `createJobQueue(scratchDb)` never touch the real
 * configured database.
 */
export function getJobQueue(): JobQueue {
  if (!singleton) {
    singleton = createJobQueue(getSqlite())
  }
  return singleton
}

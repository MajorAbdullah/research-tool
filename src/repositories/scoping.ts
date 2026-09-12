/**
 * The `user_id` scoping helper (CLAUDE.md non-negotiable: "every query goes through the user_id
 * scoping helper"). Sieve has exactly one user today, but every user-owned table already carries
 * a `user_id` column so that a second user is a signup page, not a migration — this module is
 * the mechanism that makes that true in code, not just in the schema.
 *
 * Every repository built on top of `items`/`topics`/`tags`/`chunks`/etc. should reach for
 * `scopedTo(table.userId, userId, ...)` instead of writing `eq(table.userId, userId)` inline —
 * one place to change if the scoping mechanism itself ever evolves, and a consistent, greppable
 * shape for reviewers checking that no query skipped it (plan 1.3.5's acceptance criterion is
 * literally "unscoped query caught in review" — this exists to make that review trivial).
 */

import { and, eq, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

/** Thrown when a caller has no valid authenticated user id to scope a query by. */
export class ScopingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScopingError'
  }
}

/**
 * Builds the `WHERE user_id = ? [AND ...extra]` condition every user-owned-table query must use.
 * `extra` conditions that are `undefined` are dropped, so callers can pass an optional filter
 * (`status ? eq(items.status, status) : undefined`) without an `if` at every call site.
 */
export function scopedTo(
  userIdColumn: AnySQLiteColumn,
  userId: number,
  ...extra: Array<SQL | undefined>
): SQL {
  const condition = and(eq(userIdColumn, userId), ...extra)
  // `and()`'s type is `SQL | undefined` because it can't statically know its argument list is
  // non-empty — we always pass at least the `eq(userIdColumn, userId)` above, so this is
  // unreachable in practice; the check documents that invariant instead of silently asserting it.
  if (!condition) {
    throw new ScopingError('scopedTo produced an empty condition — this should be unreachable')
  }
  return condition
}

/**
 * Normalizes and validates a session's user id into the numeric id every table's `user_id`
 * column expects. Auth.js sessions carry `user.id` as a string (JWT `sub` is conventionally a
 * string) — this is the one place that gets turned back into the number repositories need,
 * and the one place "no session" or "malformed id" becomes a thrown, catchable error instead of
 * a query silently running with `userId = NaN`.
 */
export function requireUserId(rawUserId: string | number | null | undefined): number {
  if (rawUserId === null || rawUserId === undefined || rawUserId === '') {
    throw new ScopingError('No authenticated user id available to scope this query by')
  }

  const userId = typeof rawUserId === 'string' ? Number.parseInt(rawUserId, 10) : rawUserId

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new ScopingError(`Invalid user id: ${JSON.stringify(rawUserId)}`)
  }

  return userId
}

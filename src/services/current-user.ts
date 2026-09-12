/**
 * Resolves "the" user for a bearer-token-authenticated request (the extension, and the PWA share
 * target). Sieve seeds exactly one account (ADR 0008: no multi-tenancy) — a session cookie
 * carries `session.user.id` already, but a bearer token proves only "this caller holds
 * EXTENSION_TOKEN," not which user id it's acting as, so something has to resolve that to a real
 * row. This is that something, and it's deliberately the ONLY place that does a scoping-free
 * `SELECT` against `users` — every other query in this phase goes through
 * `src/repositories/scoping.ts` once it has a `userId` in hand.
 */

import { asc } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { users } from '@/db/schema'
import { ApiError } from '@/services/http'

/**
 * Returns the single seeded user's id. Throws `INTERNAL_ERROR` (never leaked detail) if somehow
 * no user has been seeded yet — that's a boot-sequencing bug (see `src/db/seed-user.ts`), not a
 * caller error, so it is not `UNAUTHORIZED`.
 */
export function resolveSeededUserId(): number {
  const row = getDb().select({ id: users.id }).from(users).orderBy(asc(users.id)).limit(1).get()
  if (!row) {
    throw ApiError.internal()
  }
  return row.id
}

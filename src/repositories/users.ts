/**
 * User lookups. Tiny on purpose — Sieve seeds exactly one user (`pnpm seed:user`, P1) and this
 * file exists only so `resolve` (P7.1) has somewhere principled to get a `userId` from.
 */
import { asc } from 'drizzle-orm'
import { users } from '@/db/schema'
import type { DbClient } from '@/db/client'

/**
 * Resolves ownership for a freshly captured item. `ResolveJobPayload` (src/types/contracts.ts,
 * frozen — P0) carries the raw capture request (`url`, `surface`, `note?`, `hint?`) but no
 * `userId`: the capture endpoint (P8) authenticates the caller, but that identity has nowhere to
 * go in the job payload as currently shaped. Until a second user exists, "the one user who
 * exists" is an unambiguous, correct stand-in — see CLAUDE.md's Deliberate Deviations and
 * scoping.ts's header for the same "one user today, mechanism ready for more" reasoning applied
 * elsewhere. This is the single place that assumption lives, so widening `ResolveJobPayload` with
 * a real `userId` later is a one-line change here, not a hunt through every stage handler.
 */
export function getSoleUserId(db: DbClient): number {
  const row = db.select({ id: users.id }).from(users).orderBy(asc(users.id)).limit(1).get()
  if (!row) {
    throw new Error(
      'getSoleUserId: no user exists — run `pnpm seed:user` before starting the worker',
    )
  }
  return row.id
}

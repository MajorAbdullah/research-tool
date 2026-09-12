/**
 * Per-request auth resolution for this phase's routes — thin glue over P1's `src/lib/auth.ts`
 * (session + bearer-token verification) and `src/repositories/scoping.ts` (turning a session's
 * string user id into the number every query needs). Reused, not reimplemented, per this phase's
 * brief.
 *
 * `proxy.ts` already gates these routes at the middleware layer, but every route here
 * independently re-checks auth too (CLAUDE.md non-negotiable: "check authentication and
 * authorization server-side on every protected route" — not "trust one upstream gate"). It also
 * has to: a route handler under test (as `tests/integration/capture.test.ts` does) calls the
 * exported `POST`/`GET` function directly, bypassing `proxy.ts` entirely, so the 401 behaviour
 * the API contract promises has to live here regardless.
 */

import { auth, verifyExtensionToken } from '@/lib/auth'
import { requireUserId } from '@/repositories/scoping'
import { resolveSeededUserId } from '@/services/current-user'
import { ApiError } from '@/services/http'

/**
 * `POST /api/v1/capture` only (docs/API.md §1.2): session cookie OR the `EXTENSION_TOKEN` bearer
 * header. Session takes priority when both are somehow present.
 */
export async function requireCaptureUserId(request: Request): Promise<number> {
  const session = await auth()
  if (session?.user?.id) {
    return requireUserId(session.user.id)
  }
  if (verifyExtensionToken(request)) {
    return resolveSeededUserId()
  }
  throw ApiError.unauthorized()
}

/** Every other route in this phase: session cookie only — the bearer token is capture-only. */
export async function requireSessionUserId(): Promise<number> {
  const session = await auth()
  if (!session?.user?.id) {
    throw ApiError.unauthorized()
  }
  return requireUserId(session.user.id)
}

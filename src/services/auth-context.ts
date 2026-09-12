/**
 * Per-request auth resolution for this phase's routes — thin glue over P1's `src/lib/auth.ts`
 * (session + bearer-token verification) and `src/repositories/scoping.ts` (turning a session's
 * string user id into the number every query needs). Reused, not reimplemented, per this phase's
 * brief.
 *
 * IMPORTANT: `proxy.ts` does NOT currently gate anything. It was written to, and reads as
 * though it does, but it never executes — verified behaviourally: an unauthenticated GET of a
 * page returns 200 rather than redirecting, and `.next/server/middleware-manifest.json` is
 * emitted empty. Next 16.3.5 detects the file (a duplicate `middleware.ts` triggers its
 * "both detected" error) yet never compiles it into a middleware bundle.
 *
 * So these per-request checks are not defence in depth — they are the ONLY defence, which is
 * exactly why CLAUDE.md's non-negotiable says to check on every protected route rather than
 * trusting one upstream gate. A route handler under test also calls the exported `POST`/`GET`
 * directly, bypassing any middleware, so the 401 behaviour has to live here regardless.
 */

import { redirect } from 'next/navigation'

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

/**
 * For Server Component PAGES, not routes.
 *
 * `requireSessionUserId()` throws an `ApiError`, which a route handler catches and turns into a
 * clean 401 — but a page has no catch, so the same throw surfaces as a **500**. An unauthenticated
 * visitor should be sent to the login form, not shown a server error, so pages call this instead.
 *
 * This is the real auth gate for pages, because `proxy.ts` never runs (see the file header).
 */
export async function requireSessionUserIdOrRedirect(): Promise<number> {
  const session = await auth()
  if (!session?.user?.id) {
    redirect('/login')
  }
  return requireUserId(session.user.id)
}

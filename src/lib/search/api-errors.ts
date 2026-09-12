/**
 * The one error envelope docs/API.md §1.5 requires everywhere: `{ error: { code, message,
 * details, request_id } }`. `GET /api/v1/search` is the only route in this phase's scope, but
 * this lives under `src/lib/search/` (not inlined into `route.ts`) so the route handler itself
 * stays a thin parse/authorize/delegate shell, per backend-best-practices.
 */

import { NextResponse } from 'next/server'

/** The subset of docs/API.md §1.5's error codes this endpoint can actually produce —
 *  `FORBIDDEN`/`NOT_FOUND`/`RATE_LIMITED`/`LLM_BUDGET_EXHAUSTED` don't apply to a read-only,
 *  single-user, zero-LLM-cost search endpoint. */
export type SearchApiErrorCode = 'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'INTERNAL_ERROR'

const STATUS_BY_CODE: Record<SearchApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  INTERNAL_ERROR: 500,
}

export type ApiErrorDetails = Record<string, unknown>

/** One opaque id per request — logged server-side alongside the real error, and handed to the
 *  client, so "the client saw error X" becomes "here's the actual stack trace in the logs"
 *  without the stack trace ever crossing the wire (docs/API.md §1.5). */
export function generateRequestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, '')}`
}

/** Builds docs/API.md §1.5's error shape. Never pass a raw driver/SQL error or stack trace as
 *  `message`/`details` — `INTERNAL_ERROR` callers should always use the fixed generic message. */
export function apiError(
  code: SearchApiErrorCode,
  message: string,
  details: ApiErrorDetails | null = null,
  requestId: string = generateRequestId(),
): NextResponse {
  return NextResponse.json(
    { error: { code, message, details, request_id: requestId } },
    { status: STATUS_BY_CODE[code] },
  )
}

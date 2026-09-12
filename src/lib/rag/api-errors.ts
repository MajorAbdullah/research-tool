/**
 * docs/API.md §1.5's one error envelope, scoped to the subset of codes `POST /api/v1/chat` can
 * actually produce pre-stream (`VALIDATION_ERROR`, `UNAUTHORIZED`, `LLM_BUDGET_EXHAUSTED`,
 * `INTERNAL_ERROR`) — mirrors `src/lib/search/api-errors.ts`'s own file-header rationale for why
 * this is a local copy rather than a shared cross-phase helper: each route family owns the exact
 * set of codes it can produce. Mid-stream failures use the same `code`/`message`/`details` fields
 * but are framed as an `event: error` SSE frame (see `sse.ts`), never this HTTP-status helper —
 * once the stream opens, headers are already committed (docs/API.md §3.8).
 */

import { NextResponse } from 'next/server'

export type ChatApiErrorCode =
  'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'LLM_BUDGET_EXHAUSTED' | 'INTERNAL_ERROR'

const STATUS_BY_CODE: Record<ChatApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  LLM_BUDGET_EXHAUSTED: 503,
  INTERNAL_ERROR: 500,
}

export type ApiErrorDetails = Record<string, unknown>

export function generateRequestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, '')}`
}

export interface ApiErrorBody {
  error: {
    code: ChatApiErrorCode
    message: string
    details: ApiErrorDetails | null
    request_id: string
  }
}

export function buildApiErrorBody(
  code: ChatApiErrorCode,
  message: string,
  details: ApiErrorDetails | null,
  requestId: string,
): ApiErrorBody {
  return { error: { code, message, details, request_id: requestId } }
}

/** Pre-stream only — a validation/auth/budget failure the client sees as a normal JSON 4xx/503,
 *  before the SSE response ever opens (docs/API.md §3.8's "Pre-stream errors" table). */
export function apiError(
  code: ChatApiErrorCode,
  message: string,
  details: ApiErrorDetails | null = null,
  requestId: string = generateRequestId(),
): NextResponse {
  return NextResponse.json(buildApiErrorBody(code, message, details, requestId), {
    status: STATUS_BY_CODE[code],
  })
}

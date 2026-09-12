/**
 * Shared HTTP-layer plumbing for every `/api/v1/**` route this phase owns: the one error
 * envelope (docs/API.md §1.5), the response envelopes (§1.4), and cursor pagination (§1.6).
 *
 * Route handlers are supposed to "parse, authorize, delegate" (CLAUDE.md, Backend & APIs) — this
 * module is what makes that possible without every route re-deriving the wire error shape by
 * hand. Every route in this phase should look like:
 *
 *   export async function POST(request: NextRequest) {
 *     const requestId = generateRequestId()
 *     try {
 *       ...parse, authorize, delegate to a service...
 *       return NextResponse.json(result, { status: 202 })
 *     } catch (err) {
 *       return errorResponse(err, requestId)
 *     }
 *   }
 */

import { NextResponse } from 'next/server'
import type { ZodType } from 'zod'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Error shape (docs/API.md §1.5)
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_STATUS_TRANSITION'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'LLM_BUDGET_EXHAUSTED'
  | 'INTERNAL_ERROR'

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_STATUS_TRANSITION: 400,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  LLM_BUDGET_EXHAUSTED: 503,
  INTERNAL_ERROR: 500,
}

/**
 * Every intentional failure path in this phase throws one of these, and every route's catch
 * block funnels it through `errorResponse`. Never construct the wire error body by hand — that's
 * exactly the "one consistent error shape, no exceptions" rule CLAUDE.md and docs/API.md §1.5
 * both call out, and the single place it could drift is here.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly details: unknown
  /** Only meaningful for RATE_LIMITED — seconds until the caller may retry. */
  readonly retryAfterSec: number | undefined

  constructor(
    code: ApiErrorCode,
    message: string,
    options?: { details?: unknown; retryAfterSec?: number },
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
    this.details = options?.details ?? null
    this.retryAfterSec = options?.retryAfterSec
  }

  static validation(message: string, details?: unknown): ApiError {
    return new ApiError('VALIDATION_ERROR', message, { details })
  }

  static unauthorized(message = 'Missing or invalid credentials.'): ApiError {
    return new ApiError('UNAUTHORIZED', message)
  }

  static notFound(message = 'No such resource.'): ApiError {
    return new ApiError('NOT_FOUND', message)
  }

  static invalidStatusTransition(from: string, to: string, allowedNext: string[]): ApiError {
    return new ApiError('INVALID_STATUS_TRANSITION', `Cannot move from "${from}" to "${to}".`, {
      details: { from, to, allowed_next: allowedNext },
    })
  }

  static conflict(message: string, details?: unknown): ApiError {
    return new ApiError('CONFLICT', message, { details })
  }

  static payloadTooLarge(message = 'Request body is too large.'): ApiError {
    return new ApiError('PAYLOAD_TOO_LARGE', message)
  }

  static rateLimited(retryAfterSec: number): ApiError {
    return new ApiError('RATE_LIMITED', 'Too many requests. Slow down and try again shortly.', {
      retryAfterSec,
    })
  }

  static internal(message = 'Something went wrong. Try again.'): ApiError {
    return new ApiError('INTERNAL_ERROR', message)
  }
}

/** `req_<uuid>` — opaque per docs/API.md §1.5, logged server-side keyed to the same value. */
export function generateRequestId(): string {
  return `req_${crypto.randomUUID()}`
}

function errorBody(err: ApiError, requestId: string) {
  return {
    error: {
      code: err.code,
      // INTERNAL_ERROR's message is always the same generic sentence, regardless of what
      // actually failed — docs/API.md §1.5: "the real detail lives only in the server log".
      message: err.code === 'INTERNAL_ERROR' ? 'Something went wrong. Try again.' : err.message,
      details: err.details ?? null,
      request_id: requestId,
    },
  }
}

/**
 * The one place a caught error becomes an HTTP response. Anything that ISN'T already an
 * `ApiError` (a genuine bug, a driver error, a null-pointer) is logged in full server-side and
 * turned into a generic `INTERNAL_ERROR` — never a stack trace, never a raw message, over the
 * wire (docs/API.md §1.5: "Internals are never leaked").
 */
export function errorResponse(err: unknown, requestId: string): NextResponse {
  if (err instanceof ApiError) {
    if (err.code === 'INTERNAL_ERROR') {
      logger.error({ err, requestId }, 'request failed: INTERNAL_ERROR')
    }
    const init: ResponseInit = { status: err.status }
    if (err.retryAfterSec !== undefined) {
      init.headers = { 'Retry-After': String(err.retryAfterSec) }
    }
    return NextResponse.json(errorBody(err, requestId), init)
  }

  logger.error({ err, requestId }, 'request failed: unhandled exception')
  return NextResponse.json(errorBody(ApiError.internal(), requestId), { status: 500 })
}

// ---------------------------------------------------------------------------
// Zod boundary validation
// ---------------------------------------------------------------------------

/**
 * Parses `data` against `schema`, throwing a `VALIDATION_ERROR` ApiError (never a raw ZodError)
 * on failure. Surfaces only the FIRST issue in `details` — docs/API.md §1.5's example shape is a
 * single `{field, reason}` pair, not an array of every violation.
 */
export function parseWithSchema<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    const [issue] = result.error.issues
    const field = issue?.path?.length ? issue.path.join('.') : '(root)'
    const reason = issue?.message ?? 'invalid'
    throw ApiError.validation(`${field}: ${reason}`, { field, reason })
  }
  return result.data
}

// ---------------------------------------------------------------------------
// Request body reading with a hard size cap (docs/API.md §1.7)
// ---------------------------------------------------------------------------

/**
 * Reads the request body as text, rejecting with `PAYLOAD_TOO_LARGE` before or after reading if
 * it exceeds `maxBytes`. Checks `Content-Length` first (cheap, avoids buffering an obviously
 * oversized body at all); falls back to measuring the actual text for chunked requests that omit
 * the header. This is a post-hoc size check, not a streaming early-abort — acceptable at Sieve's
 * scale (CLAUDE.md: one user, `mem_limit: 1g`) and explicitly a tunable P14 hardening value
 * (docs/API.md §1.7), not an architectural guarantee.
 */
export async function readCappedText(request: Request, maxBytes: number): Promise<string> {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const declared = Number(contentLength)
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw ApiError.payloadTooLarge()
    }
  }

  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw ApiError.payloadTooLarge()
  }
  return text
}

/** Parses `text` as JSON, throwing a display-safe `VALIDATION_ERROR` (never a raw parser message). */
export function parseJsonBody(text: string): unknown {
  try {
    return text.length > 0 ? JSON.parse(text) : {}
  } catch {
    throw ApiError.validation('Request body must be valid JSON.', {
      field: '(body)',
      reason: 'invalid_json',
    })
  }
}

// ---------------------------------------------------------------------------
// Pagination (docs/API.md §1.6)
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_LIMIT = 20
export const MAX_PAGE_LIMIT = 100

/** Clamps into `1..100` rather than rejecting — docs/API.md §1.6: "Values outside 1..100 are clamped, not rejected." */
export function clampLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_PAGE_LIMIT
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_LIMIT
  return Math.min(MAX_PAGE_LIMIT, Math.max(1, parsed))
}

export interface Cursor {
  /** The sort column's value at the last row of the previous page (`null` sorts last). */
  v: number | null
  /** That row's internal id — the tiebreaker so equal sort values never drop/duplicate rows. */
  id: number
}

/** Cursor -> opaque string. Base64 JSON — an implementation detail callers must treat as opaque. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

/** Opaque string -> Cursor, or `null` if it doesn't decode to a well-formed cursor. */
export function decodeCursor(raw: string): Cursor | null {
  try {
    const json: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (
      typeof json === 'object' &&
      json !== null &&
      (typeof (json as Cursor).v === 'number' || (json as Cursor).v === null) &&
      typeof (json as Cursor).id === 'number'
    ) {
      return json as Cursor
    }
    return null
  } catch {
    return null
  }
}

export interface Page<T> {
  data: T[]
  page: { next_cursor: string | null; has_more: boolean }
}

/**
 * Given `limit + 1` rows fetched in sort order, splits them into the page to return plus
 * `has_more`/`next_cursor` — the standard "fetch one extra row" keyset-pagination trick.
 */
export function buildPage<Row, Out>(
  rows: Row[],
  limit: number,
  toOutput: (row: Row) => Out,
  cursorOf: (row: Row) => Cursor,
): Page<Out> {
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const lastRow = pageRows[pageRows.length - 1]
  return {
    data: pageRows.map(toOutput),
    page: {
      next_cursor: hasMore && lastRow ? encodeCursor(cursorOf(lastRow)) : null,
      has_more: hasMore,
    },
  }
}

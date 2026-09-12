/**
 * `POST /api/v1/capture` — docs/API.md §3.1, the most important endpoint in this document.
 *
 * This handler does exactly three things (CLAUDE.md, Backend & APIs: "Route handlers only parse,
 * authorize, delegate"): resolve who's calling, validate the body, and hand off to
 * `captureLink`. All the actual decisions (dedupe, the fresh-content upgrade path, what gets
 * enqueued) live in `src/services/capture-service.ts` — see that file and this phase's final
 * report for the reasoning.
 *
 * Nothing here ever awaits a fetch to the submitted URL, calls an LLM, or does any network I/O —
 * every step is either reading the already-buffered request body or a synchronous, local SQLite
 * call, which is what keeps this comfortably under the documented 300ms budget.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { requireCaptureUserId } from '@/services/auth-context'
import { CAPTURE_BODY_CAP_BYTES, CaptureRequestSchema } from '@/services/capture-schema'
import { captureLink } from '@/services/capture-service'
import {
  ApiError,
  errorResponse,
  generateRequestId,
  parseJsonBody,
  parseWithSchema,
  readCappedText,
} from '@/services/http'
import { captureRateLimiter } from '@/services/rate-limit'

/** Only the bearer-token path is rate-limited (docs/API.md §1.7) — see `rate-limit.ts`'s header. */
function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const [scheme, token] = header.split(' ')
  return scheme === 'Bearer' && token ? token : null
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = generateRequestId()
  try {
    const token = bearerToken(request)
    if (token) {
      const result = captureRateLimiter.check(token)
      if (!result.allowed) {
        throw ApiError.rateLimited(result.retryAfterSec)
      }
    }

    const userId = await requireCaptureUserId(request)

    const bodyText = await readCappedText(request, CAPTURE_BODY_CAP_BYTES)
    const json = parseJsonBody(bodyText)
    const body = parseWithSchema(CaptureRequestSchema, json)

    const result = captureLink(userId, body)
    return NextResponse.json(result, { status: 202 })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}

/**
 * `GET /api/v1/settings/extension-token` — returns the real `EXTENSION_TOKEN`.
 *
 * Separate from `/api/v1/settings` (which returns it masked) so the value is fetched only when
 * the user explicitly clicks "Reveal". Pairing the extension genuinely requires the token, so
 * there has to be a way to read it — but it should not sit in the HTML of a page that might be
 * open on a shared screen, which is exactly what embedding it in the server-rendered Settings
 * page would do.
 *
 * Session-cookie auth only: the extension bearer token cannot be used to read the extension
 * bearer token.
 */
import { NextResponse } from 'next/server'

import { requireSessionUserId } from '@/services/auth-context'
import { ApiError, errorResponse, generateRequestId } from '@/services/http'

export async function GET() {
  const requestId = generateRequestId()
  try {
    await requireSessionUserId()

    const token = process.env.EXTENSION_TOKEN
    if (!token) {
      throw ApiError.notFound(
        'EXTENSION_TOKEN is not set in .env — add one and restart, then the extension can pair.',
      )
    }

    return NextResponse.json(
      { token },
      // Never cached anywhere: not the browser, not a proxy.
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    )
  } catch (err) {
    return errorResponse(err, requestId)
  }
}

/**
 * `GET /api/v1/items` — docs/API.md §3.3. Session-cookie auth only; cursor-paginated per §1.6.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { requireSessionUserId } from '@/services/auth-context'
import { errorResponse, generateRequestId } from '@/services/http'
import { parseItemsListQuery } from '@/services/items-schema'
import { listItems } from '@/services/items-service'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = generateRequestId()
  try {
    const userId = await requireSessionUserId()
    const query = parseItemsListQuery(request.nextUrl.searchParams)
    const page = listItems(userId, query)
    return NextResponse.json(page, { status: 200 })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}

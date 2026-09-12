/**
 * `GET /api/v1/items/:id` and `PATCH /api/v1/items/:id` — docs/API.md §3.4/§3.5. Session-cookie
 * auth only. `[id]` is the opaque `itm_...` wire id (`src/services/ids.ts`); a malformed id and
 * an id belonging to another user both fall through to the same `NOT_FOUND` inside the service,
 * indistinguishable on purpose (docs/API.md §1.5).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { requireSessionUserId } from '@/services/auth-context'
import { errorResponse, generateRequestId, parseJsonBody, parseWithSchema } from '@/services/http'
import { ItemPatchSchema } from '@/services/items-schema'
import { getItemDetail, patchItem } from '@/services/items-service'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const requestId = generateRequestId()
  try {
    const userId = await requireSessionUserId()
    const { id } = await params
    const item = getItemDetail(userId, id)
    return NextResponse.json(item, { status: 200 })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const requestId = generateRequestId()
  try {
    const userId = await requireSessionUserId()
    const { id } = await params
    const json = parseJsonBody(await request.text())
    const body = parseWithSchema(ItemPatchSchema, json)
    const item = patchItem(userId, id, body)
    return NextResponse.json(item, { status: 200 })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}

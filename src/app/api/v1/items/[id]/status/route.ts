/**
 * `PATCH /api/v1/items/:id/status` — docs/API.md §3.6. Board drag-and-drop lands here. Every
 * transition is validated against the fixed state machine in `items-service.ts`'s
 * `STATUS_TRANSITIONS` — an illegal one is `400 INVALID_STATUS_TRANSITION`, never silently
 * clamped to the nearest legal state.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { requireSessionUserId } from '@/services/auth-context'
import { errorResponse, generateRequestId, parseJsonBody, parseWithSchema } from '@/services/http'
import { ItemStatusPatchSchema } from '@/services/items-schema'
import { patchItemStatus } from '@/services/items-service'
import type { ItemStatus } from '@/types/contracts'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const requestId = generateRequestId()
  try {
    const userId = await requireSessionUserId()
    const { id } = await params
    const json = parseJsonBody(await request.text())
    const body = parseWithSchema(ItemStatusPatchSchema, json)
    const item = patchItemStatus(userId, id, body.status as ItemStatus)
    return NextResponse.json(item, { status: 200 })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}

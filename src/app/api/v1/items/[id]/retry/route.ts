/**
 * `POST /api/v1/items/:id/retry` — docs/API.md §3.7. Same latency contract as capture: enqueues
 * and returns, never processes inline. See `items-service.ts`'s `retryItem` for the one
 * documented `JobStage` value (`resolve`) this endpoint can't actually construct a job for.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { requireSessionUserId } from '@/services/auth-context'
import { errorResponse, generateRequestId, parseJsonBody, parseWithSchema } from '@/services/http'
import { ItemRetrySchema } from '@/services/items-schema'
import { retryItem } from '@/services/items-service'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const requestId = generateRequestId()
  try {
    const userId = await requireSessionUserId()
    const { id } = await params
    const json = parseJsonBody(await request.text())
    const body = parseWithSchema(ItemRetrySchema, json)
    const result = retryItem(userId, id, body)
    return NextResponse.json(result, { status: 202 })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}

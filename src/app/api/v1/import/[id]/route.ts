/**
 * `GET /api/v1/import/:id` — docs/API.md §3.10. Progress for one import.
 *
 * The UI polls this. It is also what makes a long import legible: a backlog of ~900 links
 * drains over roughly a day against the free-tier ceiling (ADR 0004), so "how far along am
 * I and when does it resume" is the whole point rather than a nicety.
 */
import { NextResponse, type NextRequest } from 'next/server'

import { getSqlite } from '@/db/client'
import { loadAiConfig } from '@/lib/ai'
import { WhatsAppImportService, ImportNotFoundError } from '@/lib/importers'
import { requireSessionUserId } from '@/services/auth-context'
import { ApiError, errorResponse, generateRequestId } from '@/services/http'
import {
  createBudgetSource,
  createLinkEnqueuer,
  createSqliteImportProgressStore,
  generateImportId,
} from '@/services/import-wiring'

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  try {
    const userId = await requireSessionUserId()
    const { id } = await ctx.params
    const ai = loadAiConfig()
    const db = getSqlite()

    const service = new WhatsAppImportService({
      progressStore: createSqliteImportProgressStore(),
      budgetSource: createBudgetSource({
        usedToday: () =>
          Number(
            (
              db
                .prepare("select value v from settings where key = 'llm_requests_used_today'")
                .get() as { v: string } | undefined
            )?.v ?? 0,
          ),
        dailyCap: ai.dailyCap,
        interactiveReserve: ai.interactiveReserve,
        resetsAt: () => {
          const now = new Date()
          return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
        },
      }),
      linkEnqueuer: createLinkEnqueuer(userId),
      dailyBackgroundBudget: Math.max(0, ai.dailyCap - ai.interactiveReserve),
      generateId: generateImportId,
    })

    return NextResponse.json(await service.getStatus(id))
  } catch (err) {
    if (err instanceof ImportNotFoundError) {
      return errorResponse(ApiError.notFound('No such import.'), requestId)
    }
    return errorResponse(err, requestId)
  }
}

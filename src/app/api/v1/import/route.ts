/**
 * `POST /api/v1/import` — docs/API.md §3.9. Overloaded on content type, as the doc specifies:
 *
 *   multipart/form-data   upload a WhatsApp export (dry-run by default)
 *   application/json      act on an existing import: commit | pause | resume | cancel
 *
 * All parsing and queue logic lives in `WhatsAppImportService` (P12); this route only supplies
 * the real ports, authorizes, and translates errors. That split is why the service has 137
 * unit tests with no DB, no HTTP and no LLM anywhere near them.
 */
import { NextResponse, type NextRequest } from 'next/server'

import { getSqlite } from '@/db/client'
import { loadAiConfig } from '@/lib/ai'
import {
  WhatsAppImportService,
  ImportNotFoundError,
  InvalidImportTransitionError,
  type ImportAction,
} from '@/lib/importers'
import { requireSessionUserId } from '@/services/auth-context'
import { ApiError, errorResponse, generateRequestId, parseJsonBody } from '@/services/http'
import {
  createBudgetSource,
  createLinkEnqueuer,
  createSqliteImportProgressStore,
  generateImportId,
} from '@/services/import-wiring'

/** docs/API.md §1.7: import upload is capped at 50 MB, beyond which 413. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const VALID_ACTIONS = new Set<ImportAction>(['commit', 'pause', 'resume', 'cancel'])

function buildService(userId: number): WhatsAppImportService {
  const ai = loadAiConfig()
  const db = getSqlite()

  const usedToday = () =>
    Number(
      (
        db.prepare("select value v from settings where key = 'llm_requests_used_today'").get() as
          { v: string } | undefined
      )?.v ?? 0,
    )
  const resetsAt = () => {
    const now = new Date()
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  }

  return new WhatsAppImportService({
    progressStore: createSqliteImportProgressStore(),
    budgetSource: createBudgetSource({
      usedToday,
      dailyCap: ai.dailyCap,
      interactiveReserve: ai.interactiveReserve,
      resetsAt,
    }),
    linkEnqueuer: createLinkEnqueuer(userId),
    dailyBackgroundBudget: Math.max(0, ai.dailyCap - ai.interactiveReserve),
    generateId: generateImportId,
  })
}

/** Every `url_hash` already in the library, so a re-import of the same export is a no-op. */
function existingUrlHashes(userId: number): ReadonlySet<string> {
  const rows = getSqlite()
    .prepare('select url_hash from items where user_id = ?')
    .all(userId) as Array<{ url_hash: string }>
  return new Set(rows.map((r) => r.url_hash))
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()
  try {
    const userId = await requireSessionUserId()
    const service = buildService(userId)
    const contentType = request.headers.get('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('file')
      if (!(file instanceof File)) {
        throw ApiError.validation('Attach the WhatsApp export as a "file" field.')
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        throw ApiError.payloadTooLarge(
          `That export is ${(file.size / 1048576).toFixed(1)} MB. The limit is 50 MB — export without media.`,
        )
      }

      const rawMode = form.get('mode')
      const mode = rawMode === 'commit' ? 'commit' : 'dry_run'

      const view = await service.ingestUpload({
        fileBuffer: Buffer.from(await file.arrayBuffer()),
        filename: file.name,
        mode,
        existingUrlHashes: existingUrlHashes(userId),
      })
      return NextResponse.json(view, { status: 202 })
    }

    const body = parseJsonBody(await request.text()) as {
      import_id?: unknown
      action?: unknown
    }
    if (typeof body.import_id !== 'string' || !VALID_ACTIONS.has(body.action as ImportAction)) {
      throw ApiError.validation(
        'Send { import_id, action } where action is commit, pause, resume or cancel.',
      )
    }
    const view = await service.applyAction(body.import_id, body.action as ImportAction)
    return NextResponse.json(view)
  } catch (err) {
    if (err instanceof ImportNotFoundError) {
      return errorResponse(ApiError.notFound('No such import.'), requestId)
    }
    if (err instanceof InvalidImportTransitionError) {
      return errorResponse(ApiError.validation(err.message), requestId)
    }
    return errorResponse(err, requestId)
  }
}

/**
 * `GET /api/v1/search` — hybrid search (docs/API.md §3.2): FTS5 (`bm25()`) fused with `vec0` kNN
 * via Reciprocal Rank Fusion. Query embedding runs on the local embedding model — search never
 * spends OpenRouter quota (ADR 0003).
 *
 * This route only parses, authorizes, and delegates (backend-best-practices) — the actual
 * retrieval/fusion/pagination logic lives in `@/lib/search`, and is unit-tested there directly
 * against an in-memory DB rather than through HTTP.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { auth } from '@/lib/auth'
import { requireUserId, ScopingError } from '@/repositories/scoping'
import { getSqlite } from '@/db/client'
import { getLocalEmbeddingProvider } from '@/lib/embeddings'
import { logger } from '@/lib/logger'
import {
  hybridSearch,
  ftsOnlySearch,
  parseSearchQuery,
  apiError,
  generateRequestId,
} from '@/lib/search'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = generateRequestId()

  const session = await auth()
  let userId: number
  try {
    userId = requireUserId(session?.user?.id)
  } catch (err) {
    if (err instanceof ScopingError) {
      return apiError('UNAUTHORIZED', 'Sign in to search your library.', null, requestId)
    }
    throw err
  }

  let parsed
  try {
    parsed = parseSearchQuery(request.nextUrl.searchParams)
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0]
      return apiError(
        'VALIDATION_ERROR',
        issue?.message ?? 'Invalid search request.',
        { field: issue ? String(issue.path[0] ?? 'q') : 'q', reason: issue?.message ?? null },
        requestId,
      )
    }
    throw err
  }

  try {
    const sqlite = getSqlite()
    const searchOptions = {
      userId,
      query: parsed.q,
      filters: parsed.filters,
      cursor: parsed.cursor,
      limit: parsed.limit,
    }

    // Always the LOCAL embedding provider, never `selectEmbeddingProviderFromEnv()` — a
    // deliberate coupling, not an oversight. docs/API.md §3.2 and ADR 0003 both state, as an
    // unconditional property of this system, that search spends zero OpenRouter quota; switching
    // `EMBEDDING_PROVIDER` to `openrouter` is itself a whole-corpus, `pnpm reembed`-gated decision
    // (ADR 0003) owned by `@/lib/embeddings`, at which point this one line would need to follow —
    // building speculative dynamic provider-switching into search today, for a path nothing in
    // this deployment currently uses, is exactly what CLAUDE.md's KISS/YAGNI rule argues against.
    const result =
      parsed.tier === 'fts'
        ? ftsOnlySearch(sqlite, searchOptions)
        : await hybridSearch(sqlite, getLocalEmbeddingProvider(), searchOptions)

    return NextResponse.json(result)
  } catch (err) {
    logger.error({ err, requestId, userId }, 'search: request failed')
    return apiError('INTERNAL_ERROR', 'Something went wrong. Try again.', null, requestId)
  }
}

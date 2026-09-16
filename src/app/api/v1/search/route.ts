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
import { createEmbeddingProviderFromConfig } from '@/lib/embeddings'
import { BudgetManager, createSqliteSettingsPort } from '@/lib/ai'
import { getConfig } from '@/lib/config'
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

    // Follows EMBEDDING_PROVIDER, via the config factory. It used to be pinned to the local
    // provider, on the grounds that search spending zero OpenRouter quota was an unconditional
    // property of the system; that comment also predicted that switching the provider was "a
    // whole-corpus, pnpm reembed-gated decision ... at which point this one line would need to
    // follow". That decision has now been taken (ADR 0003 amendment), so it follows.
    //
    // With the hosted provider, a query embedding is a network call that can fail or run the
    // daily budget out — so the hybrid path degrades to keyword-only rather than erroring. See
    // CLAUDE.md: "the system stays useful at zero budget ... Never break that property."
    let result
    if (parsed.tier === 'fts') {
      result = ftsOnlySearch(sqlite, searchOptions)
    } else {
      try {
        const config = getConfig()
        // `interactive` lane: a search is something the user is waiting on, so it may draw on the
        // reserve that background ingest deliberately cannot touch. For the local provider the
        // budget argument is ignored entirely — it costs no requests.
        const embeddingProvider = createEmbeddingProviderFromConfig({
          config,
          budget: new BudgetManager(
            createSqliteSettingsPort(sqlite),
            config.llmDailyCap,
            config.llmInteractiveReserve,
          ),
          lane: 'interactive',
        })
        result = await hybridSearch(sqlite, embeddingProvider, searchOptions)
      } catch (err) {
        // Deliberately broad: budget exhaustion, a timeout, a 429, or the box being offline all
        // land here, and the right response to every one of them is the same — return keyword
        // results now rather than nothing. Logged at warn (not swallowed) so a provider that is
        // failing constantly is visible instead of just quietly feeling worse than it should.
        logger.warn(
          { err, requestId, userId },
          'search: embedding provider unavailable — degrading to keyword-only (FTS)',
        )
        result = ftsOnlySearch(sqlite, searchOptions)
      }
    }

    return NextResponse.json(result)
  } catch (err) {
    logger.error({ err, requestId, userId }, 'search: request failed')
    return apiError('INTERNAL_ERROR', 'Something went wrong. Try again.', null, requestId)
  }
}

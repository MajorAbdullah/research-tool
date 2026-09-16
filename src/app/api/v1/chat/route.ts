/**
 * `POST /api/v1/chat` — Ask-my-library chat (docs/API.md §3.8). Retrieval, groundedness gating,
 * and generation all live in `@/lib/rag`; this route only parses, authorizes, wires the AI
 * provider stack, and sequences the SSE event stream (backend-best-practices: routes parse,
 * authorize, delegate).
 *
 * ## SSE error framing — read before touching this file
 *
 * The initial `200` is sent only once retrieval has started; before that, a validation/auth/
 * budget failure is a normal JSON 4xx/503 (the "Pre-stream errors" table below). Once
 * `Content-Type: text/event-stream` and the `200` go out, headers are committed — there is no
 * mechanism to change the HTTP status after that point. Every failure past that line is an
 * `event: error` SSE frame, never a status code (docs/API.md §3.8 and §4's design-notes table).
 *
 * ## Why `event: token` isn't literally token-by-token
 *
 * `createChatProvider()` (`@/lib/ai`, frozen for this phase) resolves a complete answer from one
 * non-streaming OpenRouter call — see `@/lib/rag/stream-chunks.ts`'s header for the full
 * explanation. This route still opens the SSE stream immediately (so `sources` really does arrive
 * before generation starts) and flushes the finished answer as several `token` frames, but the
 * time-to-first-token is bounded below by the underlying model call's own latency, not by this
 * route. See the phase report for measured numbers against the real corpus.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ZodError } from 'zod'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { requireUserId, ScopingError } from '@/repositories/scoping'
import { getSqlite } from '@/db/client'
import { getConfig } from '@/lib/config'
import { createEmbeddingProviderFromConfig } from '@/lib/embeddings'
import { logger } from '@/lib/logger'
import { ItemKind } from '@/types/contracts'
import type { CreateProviderDeps } from '@/lib/ai'
import {
  BudgetManager,
  TokenBucket,
  RATE_LIMIT_PER_MINUTE,
  createCapabilityProbe,
  createSqliteSettingsPort,
  createSqliteLlmCallLog,
  createChatProvider,
  BudgetExhaustedError,
} from '@/lib/ai'
import {
  apiError,
  buildApiErrorBody,
  generateRequestId,
  formatSseEvent,
  retrieveCandidates,
  assembleContext,
  buildChatMessages,
  generateGroundedAnswer,
  splitIntoStreamChunks,
  computeCacheKey,
  getCachedAnswer,
  setCachedAnswer,
  getOrCreateConversation,
  loadHistory,
  appendUserMessage,
  appendAssistantMessage,
  toMessageWireId,
  INSUFFICIENT_CONTEXT_MESSAGE,
  type ChatFilters,
  type ChatSource,
} from '@/lib/rag'

export const runtime = 'nodejs'

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

const ITEM_KIND_VALUES = Object.values(ItemKind) as [ItemKind, ...ItemKind[]]

const MAX_MESSAGE_LENGTH = 4_000

const ChatRequestSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'message is required')
    .max(MAX_MESSAGE_LENGTH, `message must be at most ${MAX_MESSAGE_LENGTH} characters`),
  conversation_id: z.string().optional(),
  filters: z
    .object({
      kind: z.enum(ITEM_KIND_VALUES).optional(),
      topic: z.string().trim().min(1).optional(),
    })
    .optional(),
})

// ---------------------------------------------------------------------------
// AI provider stack — one process-wide instance, built lazily on first request.
//
// Mirrors src/worker/bootstrap.ts's own wiring (CapabilityProbe / BudgetManager / TokenBucket /
// LlmCallLog around createChatProvider) rather than reinventing it, with one deliberate
// difference: `BudgetManager` and the call log are backed by `createSqlite*(getSqlite())`, the
// SAME underlying `settings`/`llm_calls` tables the worker's own instances read and write — so the
// account-wide daily counter (ADR 0004) is correctly shared across this route and the background
// pipeline even though the two are separately-constructed objects. `TokenBucket` (the in-memory
// ~18/min pacer) is NOT shared this way — it has no DB-backed state to share through, and P7's
// bootstrap keeps its instance private to its own module. A chat request and a background job
// landing in the same minute could therefore, in the worst case, each think they have the full
// per-minute allowance. This is an accepted, low-severity gap: the per-minute number is a pacing
// safety margin under OpenRouter's platform ceiling, not the primary budget mechanism (the
// correctly-shared daily cap is), and the chain-fallover machinery already treats a 429 as
// "try the next model" rather than a hard failure.
// ---------------------------------------------------------------------------

const CHAT_PROMPT_VERSION = 'chat.v1'

interface ChatAiDeps {
  providerDeps: CreateProviderDeps
  budget: BudgetManager
}

declare global {
  // `var` (not let/const) is required here — TS only merges global augmentations declared this
  // way. This is a type-only ambient declaration; it has no runtime effect of its own. See
  // src/db/client.ts's identical pattern for `__sieveSqlite`.

  var __sieveChatAiDeps: Promise<ChatAiDeps> | undefined
}

async function buildChatAiDeps(): Promise<ChatAiDeps> {
  const config = getConfig()
  const sqlite = getSqlite()

  const capabilityProbe = await createCapabilityProbe({ apiKey: config.openRouterApiKey })
  const budget = new BudgetManager(
    createSqliteSettingsPort(sqlite),
    config.llmDailyCap,
    config.llmInteractiveReserve,
  )
  const rateLimiter = new TokenBucket({
    capacity: RATE_LIMIT_PER_MINUTE,
    refillPerMinute: RATE_LIMIT_PER_MINUTE,
  })
  const callLog = createSqliteLlmCallLog(sqlite)

  const providerDeps: CreateProviderDeps = {
    apiKey: config.openRouterApiKey,
    chainEnrich: config.llmChainEnrich,
    chainChat: config.llmChainChat,
    capabilityProbe,
    budget,
    rateLimiter,
    callLog,
    promptVersion: CHAT_PROMPT_VERSION,
  }
  return { providerDeps, budget }
}

function getChatAiDeps(): Promise<ChatAiDeps> {
  if (!globalThis.__sieveChatAiDeps) {
    globalThis.__sieveChatAiDeps = buildChatAiDeps().catch((err: unknown) => {
      // Don't cache a failed boot forever — a transient catalog-fetch hiccup shouldn't
      // permanently wedge the endpoint.
      globalThis.__sieveChatAiDeps = undefined
      throw err
    })
  }
  return globalThis.__sieveChatAiDeps
}

// ---------------------------------------------------------------------------
// Wire mapping (docs/API.md §3.8)
// ---------------------------------------------------------------------------

function toWireSource(source: ChatSource): {
  index: number
  item_id: string
  title: string | null
} {
  return { index: source.index, item_id: source.wireId, title: source.title }
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Disables response buffering on an nginx-fronted deploy (deploy/ + host vhost, per CLAUDE.md's
  // devops section) — without it, a reverse proxy can hold the whole SSE body until it closes.
  'X-Accel-Buffering': 'no',
} as const

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = generateRequestId()

  const session = await auth()
  let userId: number
  try {
    userId = requireUserId(session?.user?.id)
  } catch (err) {
    if (err instanceof ScopingError) {
      return apiError('UNAUTHORIZED', 'Sign in to chat with your library.', null, requestId)
    }
    throw err
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Request body must be valid JSON.', null, requestId)
  }

  let parsed: z.infer<typeof ChatRequestSchema>
  try {
    parsed = ChatRequestSchema.parse(rawBody)
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0]
      return apiError(
        'VALIDATION_ERROR',
        issue?.message ?? 'Invalid chat request.',
        {
          field: issue ? String(issue.path[0] ?? 'message') : 'message',
          reason: issue?.message ?? null,
        },
        requestId,
      )
    }
    throw err
  }

  let aiDeps: ChatAiDeps
  try {
    aiDeps = await getChatAiDeps()
  } catch (err) {
    logger.error({ err, requestId, userId }, 'chat: failed to initialize the AI provider stack')
    return apiError('INTERNAL_ERROR', 'Something went wrong. Try again.', null, requestId)
  }

  // Pre-stream budget peek (docs/API.md §3.8: rare — the interactive lane is exhausted before
  // retrieval even starts). A PEEK, not a reservation: `budget.status()` never writes/consumes —
  // the real reservation happens once, per attempt, inside the chain runner during generation.
  const budgetStatus = aiDeps.budget.status()
  if (budgetStatus.usedToday >= budgetStatus.dailyCap) {
    return apiError(
      'LLM_BUDGET_EXHAUSTED',
      "Today's AI budget is spent. Resumes at midnight UTC.",
      { resets_at: budgetStatus.resetAt },
      requestId,
    )
  }

  const sqlite = getSqlite()
  // Follows EMBEDDING_PROVIDER like every other retrieval path. Pinning this to the local
  // provider produced 384-d query vectors against a 2048-d index once the deployment moved to a
  // hosted model. `interactive` lane: the user is waiting on this answer.
  const embeddingProvider = createEmbeddingProviderFromConfig({
    budget: aiDeps.budget,
    lane: 'interactive',
  })
  const message = parsed.message
  const chatFilters: ChatFilters = { kind: parsed.filters?.kind, topic: parsed.filters?.topic }
  const encoder = new TextEncoder()

  // Set by `cancel()` below when the client goes away mid-stream (tab closed, navigation, lost
  // connection) — `ReadableStream` calls `cancel()` in exactly that case, but does NOT stop the
  // `start()` promise chain still running underneath it. Without this guard, a `send()` after
  // that point throws `TypeError: Invalid state: Controller is already closed` — verified live
  // (a real browser tab navigating away mid-generation reproduced this every time) — which
  // otherwise becomes an unhandled rejection instead of the clean, silent no-op a disconnected
  // client should get. The pipeline itself (generation, persistence, caching, logging) still runs
  // to completion regardless — the LLM call already started, and the answer is still worth
  // caching and logging even if this particular client isn't around to see it stream back.
  let clientGone = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown): void => {
        if (clientGone) return
        try {
          controller.enqueue(encoder.encode(formatSseEvent(event, data)))
        } catch {
          // Lost the race against `cancel()` (it fires asynchronously) — same intent as the
          // `clientGone` check above, just covering the narrow window between the two.
          clientGone = true
        }
      }

      // Correlates every log line for this turn, independent of `requestId` (which is per-HTTP-
      // request) — useful once a conversation spans several requests.
      const turnId = randomUUID()

      try {
        // History is read BEFORE this turn's user message is appended, so it never includes the
        // question this turn is currently answering.
        const conversation = getOrCreateConversation(
          sqlite,
          userId,
          parsed.conversation_id,
          message,
        )
        const history = loadHistory(sqlite, userId, conversation.id)
        appendUserMessage(sqlite, { conversationId: conversation.id, userId, content: message })

        const cacheKey = computeCacheKey(userId, message, chatFilters)
        const cached = getCachedAnswer(sqlite, userId, cacheKey)

        if (cached) {
          send('sources', { sources: cached.sources.map(toWireSource) })
          for (const chunk of splitIntoStreamChunks(cached.answer)) send('token', { text: chunk })
          const messageId = appendAssistantMessage(sqlite, {
            conversationId: conversation.id,
            userId,
            content: cached.answer,
            sources: cached.sources,
            grounded: cached.grounded,
            retrievedChunks: [],
          })
          send('done', {
            conversation_id: conversation.wireId,
            message_id: toMessageWireId(messageId),
            grounded: cached.grounded,
          })
          logger.info(
            { requestId, turnId, userId, conversationId: conversation.wireId, cacheHit: true },
            'chat: answered from cache — zero retrieval, zero LLM requests spent',
          )
          return
        }

        const raw = await retrieveCandidates(
          { sqlite, embeddingProvider },
          { userId, query: message, filters: chatFilters },
        )
        const assembled = assembleContext(raw.items)
        const grounded = raw.groundedPreGate && assembled.sources.length > 0

        send('sources', { sources: assembled.sources.map(toWireSource) })

        if (!grounded) {
          send('token', { text: INSUFFICIENT_CONTEXT_MESSAGE })
          const messageId = appendAssistantMessage(sqlite, {
            conversationId: conversation.id,
            userId,
            content: INSUFFICIENT_CONTEXT_MESSAGE,
            sources: [],
            grounded: false,
            retrievedChunks: assembled.retrievedChunks,
          })
          setCachedAnswer(sqlite, userId, cacheKey, {
            answer: INSUFFICIENT_CONTEXT_MESSAGE,
            sources: [],
            grounded: false,
          })
          send('done', {
            conversation_id: conversation.wireId,
            message_id: toMessageWireId(messageId),
            grounded: false,
          })
          logger.info(
            {
              requestId,
              turnId,
              userId,
              conversationId: conversation.wireId,
              grounded: false,
              retrievedChunks: assembled.retrievedChunks,
            },
            'chat: answered — retrieval too weak to attempt generation (no LLM call made)',
          )
          return
        }

        const { messages } = buildChatMessages({
          question: message,
          contextBlocks: assembled.contextBlocks,
          history,
          filters: chatFilters,
        })

        const provider = createChatProvider(aiDeps.providerDeps)
        const result = await generateGroundedAnswer(provider, messages, assembled.sources.length)

        for (const chunk of splitIntoStreamChunks(result.text)) send('token', { text: chunk })

        const finalSources = result.grounded ? assembled.sources : []
        const messageId = appendAssistantMessage(sqlite, {
          conversationId: conversation.id,
          userId,
          content: result.text,
          sources: finalSources,
          grounded: result.grounded,
          retrievedChunks: assembled.retrievedChunks,
        })
        setCachedAnswer(sqlite, userId, cacheKey, {
          answer: result.text,
          sources: finalSources,
          grounded: result.grounded,
        })

        send('done', {
          conversation_id: conversation.wireId,
          message_id: toMessageWireId(messageId),
          grounded: result.grounded,
        })
        logger.info(
          {
            requestId,
            turnId,
            userId,
            conversationId: conversation.wireId,
            grounded: result.grounded,
            citationRetryUsed: result.citationRetryUsed,
            citationValidationFailed: result.citationValidationFailed,
            modelRequested: result.meta.modelRequested,
            modelResolved: result.meta.modelResolved,
            promptVersion: CHAT_PROMPT_VERSION,
            retrievedChunks: assembled.retrievedChunks,
          },
          'chat: answered',
        )
      } catch (err) {
        if (err instanceof BudgetExhaustedError) {
          send(
            'error',
            buildApiErrorBody(
              'LLM_BUDGET_EXHAUSTED',
              "Today's AI budget is spent. Resumes at midnight UTC.",
              { resets_at: err.resetAt },
              requestId,
            ).error,
          )
        } else {
          logger.error({ err, requestId, turnId, userId }, 'chat: request failed mid-stream')
          send(
            'error',
            buildApiErrorBody('INTERNAL_ERROR', 'Something went wrong. Try again.', null, requestId)
              .error,
          )
        }
      } finally {
        if (!clientGone) {
          try {
            controller.close()
          } catch {
            // The client disconnected in the exact instant between the last `send()` and here —
            // nothing left to close for.
          }
        }
      }
    },
    cancel() {
      // Called by the runtime when the consumer goes away (tab closed, navigation, aborted
      // fetch) — see the `clientGone` doc comment above for why this exists.
      clientGone = true
    },
  })

  return new Response(stream, { status: 200, headers: SSE_HEADERS })
}

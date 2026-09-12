/**
 * Client-side fetch wrappers for every endpoint this phase's UI calls (docs/API.md §3.2-§3.5,
 * §3.7). Deliberately plain `fetch` against the real, versioned HTTP API — not a direct import of
 * `@/services/items-service.ts` — because that's what every non-Server-Component caller of this
 * API is (the extension, a future client, and this UI), and because it's the one code path this
 * phase, the API contract, and a route-handler test can all agree on. Relative URLs + the
 * browser's default same-origin credentials mean the session cookie rides along with every call
 * automatically; this module is client-only (relative-URL `fetch` has no meaning on the server)
 * even though it carries no `'use client'` directive itself — same convention as
 * `@/services/http.ts` (a plain-functions module, no directive), just for the other side of the
 * wire.
 */

import type {
  ExtractionTier,
  GithubKindFields,
  ItemDetail,
  ItemKind,
  ItemRelation,
  ItemStatus,
  ItemSummary,
  SearchResultSummary,
  SourceSurface,
  Topic,
  WirePage,
} from '@/components/library/types'

// ---------------------------------------------------------------------------
// Error shape (docs/API.md §1.5) — parsing is a pure function, tested directly.
// ---------------------------------------------------------------------------

export interface WireErrorBody {
  error?: {
    code?: unknown
    message?: unknown
    details?: unknown
    request_id?: unknown
  }
}

const FALLBACK_MESSAGE = 'Something went wrong. Try again.'

export class ApiClientError extends Error {
  readonly code: string
  readonly status: number
  readonly details: unknown
  readonly requestId: string | null

  constructor(
    status: number,
    code: string,
    message: string,
    details: unknown = null,
    requestId: string | null = null,
  ) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
    this.details = details
    this.requestId = requestId
  }
}

/** `{status, parsed JSON body}` -> a typed `ApiClientError`. Never throws itself — a body that doesn't match the envelope still produces a display-safe fallback error, never a raw parser exception. */
export function parseErrorBody(status: number, body: unknown): ApiClientError {
  const candidate = body && typeof body === 'object' ? (body as WireErrorBody).error : undefined
  if (candidate && typeof candidate.code === 'string' && typeof candidate.message === 'string') {
    return new ApiClientError(
      status,
      candidate.code,
      candidate.message,
      candidate.details ?? null,
      typeof candidate.request_id === 'string' ? candidate.request_id : null,
    )
  }
  return new ApiClientError(status, 'INTERNAL_ERROR', FALLBACK_MESSAGE)
}

async function readJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await readJsonSafe(res)
  if (!res.ok) throw parseErrorBody(res.status, body)
  return body as T
}

// ---------------------------------------------------------------------------
// GET /api/v1/items (docs/API.md §3.3)
// ---------------------------------------------------------------------------

export interface FetchItemsPageOptions {
  cursor?: string
  limit?: number
}

export async function fetchItemsPage(
  baseParams: URLSearchParams,
  { cursor, limit = 20 }: FetchItemsPageOptions = {},
): Promise<WirePage<ItemSummary>> {
  const params = new URLSearchParams(baseParams)
  params.set('limit', String(limit))
  if (cursor) params.set('cursor', cursor)
  else params.delete('cursor')
  return request<WirePage<ItemSummary>>(`/api/v1/items?${params.toString()}`)
}

// ---------------------------------------------------------------------------
// GET /api/v1/search (docs/API.md §3.2, `tier` per src/lib/search/query-schema.ts)
// ---------------------------------------------------------------------------

export type SearchTier = 'fts' | 'hybrid'

export interface FetchSearchPageOptions {
  cursor?: string
  limit?: number
  tier?: SearchTier
}

export async function fetchSearchPage(
  baseParams: URLSearchParams,
  { cursor, limit = 20, tier }: FetchSearchPageOptions = {},
): Promise<WirePage<SearchResultSummary>> {
  const params = new URLSearchParams(baseParams)
  params.set('limit', String(limit))
  if (cursor) params.set('cursor', cursor)
  else params.delete('cursor')
  if (tier) params.set('tier', tier)
  else params.delete('tier')
  return request<WirePage<SearchResultSummary>>(`/api/v1/search?${params.toString()}`)
}

// ---------------------------------------------------------------------------
// GET /api/v1/items/:id (docs/API.md §3.4)
// ---------------------------------------------------------------------------

export async function fetchItemDetail(id: string): Promise<ItemDetail> {
  return request<ItemDetail>(`/api/v1/items/${encodeURIComponent(id)}`)
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/items/:id (docs/API.md §3.5)
// ---------------------------------------------------------------------------

export interface ItemPatchInput {
  note?: string | null
  outcome_note?: string | null
  starred?: boolean
  tags?: string[]
  topic?: string | null
}

export async function patchItem(id: string, patch: ItemPatchInput): Promise<ItemDetail> {
  return request<ItemDetail>(`/api/v1/items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

// ---------------------------------------------------------------------------
// POST /api/v1/items/:id/retry (docs/API.md §3.7)
// ---------------------------------------------------------------------------

/** The two stages this UI's buttons fire — "Re-extract"/"Re-enrich" (deliverable #11); the other four `JobStage` values exist for the pipeline's own internal retries, not a user-facing button. */
export type RetryStage = 'extract' | 'enrich'

export interface RetryResult {
  id: string
  status: ItemStatus
  stage: RetryStage
}

export async function retryItemStage(id: string, stage: RetryStage): Promise<RetryResult> {
  return request<RetryResult>(`/api/v1/items/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
    body: JSON.stringify({ stage }),
  })
}

// Re-exported so components importing from this module for data calls don't also need a second
// import line from './types' just to type a variable holding one of these.
export type {
  ExtractionTier,
  GithubKindFields,
  ItemDetail,
  ItemKind,
  ItemRelation,
  ItemStatus,
  ItemSummary,
  SearchResultSummary,
  SourceSurface,
  Topic,
  WirePage,
}

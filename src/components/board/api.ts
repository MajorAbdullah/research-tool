/**
 * Fetch wrappers for the board's own calls into docs/API.md §3.3 (`GET /items`), §3.4
 * (`GET /items/:id`), §3.5 (`PATCH /items/:id`), and §3.6 (`PATCH /items/:id/status`).
 *
 * Kept local to `components/board/` rather than a shared `src/services/**` client: this phase
 * owns only `src/app/(board)/**` / `src/components/board/**` / `tests/unit/board/**`, and the
 * existing capture pages (`src/app/(capture)/**`) already establish the precedent — each phase's
 * UI talks to `/api/v1/**` directly with `fetch` and its own session cookie (sent automatically,
 * same-origin), there is no shared client layer this phase is meant to plug into.
 */

import type { ItemStatus, ItemSummary } from './board-types'

export interface ApiErrorBody {
  code: string
  message: string
  details: unknown
  request_id: string
}

/** Thrown for any non-2xx response, carrying docs/API.md §1.5's error envelope. */
export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown
  readonly requestId: string

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = body.code
    this.details = body.details
    this.requestId = body.request_id
  }
}

const GENERIC_ERROR_BODY: ApiErrorBody = {
  code: 'INTERNAL_ERROR',
  message: 'Something went wrong. Try again.',
  details: null,
  request_id: '',
}

function isErrorEnvelope(value: unknown): value is { error: Partial<ApiErrorBody> } {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const err = (value as { error: unknown }).error
  return typeof err === 'object' && err !== null
}

async function parseErrorBody(response: Response): Promise<ApiErrorBody> {
  try {
    const json: unknown = await response.json()
    if (isErrorEnvelope(json)) {
      const err = json.error
      return {
        code: typeof err.code === 'string' ? err.code : GENERIC_ERROR_BODY.code,
        message: typeof err.message === 'string' ? err.message : GENERIC_ERROR_BODY.message,
        details: err.details ?? null,
        request_id: typeof err.request_id === 'string' ? err.request_id : '',
      }
    }
  } catch {
    // Body wasn't JSON (e.g. a proxy-level 502 HTML page) — fall through to the generic shape.
  }
  return GENERIC_ERROR_BODY
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(input, { ...init, headers: { ...headers, ...init?.headers } })
  if (!response.ok) {
    throw new ApiRequestError(response.status, await parseErrorBody(response))
  }
  // 204/empty-body responses aren't used by any endpoint this file calls, so a bare `.json()` is safe.
  return (await response.json()) as T
}

export interface ItemsPage {
  data: ItemSummary[]
  page: { next_cursor: string | null; has_more: boolean }
}

// docs/API.md §1.6 caps `limit` at 100/page; 50 pages is 5,000 items, generous headroom over any
// realistic single-user library size for a good while — a safety valve against an infinite loop,
// not an expected ceiling.
const MAX_PAGES = 50

/**
 * Every item the board needs, across every status — fetched once, bucketed into columns
 * client-side (board-filters.ts, board-rank.ts), rather than one `GET` per column/status. Loops
 * cursor pages per docs/API.md §1.6 (never offset pagination).
 */
export async function fetchAllItems(): Promise<ItemSummary[]> {
  const items: ItemSummary[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ limit: '100' })
    if (cursor) params.set('cursor', cursor)
    const result = await requestJson<ItemsPage>(`/api/v1/items?${params.toString()}`)
    items.push(...result.data)
    if (!result.page.has_more || !result.page.next_cursor) break
    cursor = result.page.next_cursor
  }
  return items
}

/** `PATCH /api/v1/items/:id/status` (docs/API.md §3.6). Rejects with `ApiRequestError` on 400/404. */
export async function patchItemStatus(id: string, status: ItemStatus): Promise<ItemSummary> {
  return requestJson<ItemSummary>(`/api/v1/items/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export interface ItemFieldPatch {
  outcome_note?: string | null
  tags?: string[]
}

/** `PATCH /api/v1/items/:id` (docs/API.md §3.5), restricted to the fields the board actually edits. */
export async function patchItemFields(
  id: string,
  patch: ItemFieldPatch,
): Promise<ItemSummary & { outcome_note: string | null }> {
  return requestJson(`/api/v1/items/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export interface ItemDetailForBoard {
  id: string
  outcome_note: string | null
}

/** `GET /api/v1/items/:id` (docs/API.md §3.4) — the list endpoint's `ItemSummary` doesn't carry `outcome_note`. */
export async function fetchItemDetail(id: string): Promise<ItemDetailForBoard> {
  return requestJson<ItemDetailForBoard>(`/api/v1/items/${id}`)
}

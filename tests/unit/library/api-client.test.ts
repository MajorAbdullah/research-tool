import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiClientError,
  fetchItemsPage,
  parseErrorBody,
  patchItem,
  retryItemStage,
} from '@/components/library/api-client'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('parseErrorBody', () => {
  it('extracts code/message/details/request_id from a well-formed error envelope', () => {
    const err = parseErrorBody(404, {
      error: {
        code: 'NOT_FOUND',
        message: 'No such resource.',
        details: null,
        request_id: 'req_1',
      },
    })
    expect(err).toBeInstanceOf(ApiClientError)
    expect(err.status).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toBe('No such resource.')
    expect(err.requestId).toBe('req_1')
  })

  it('falls back to a generic INTERNAL_ERROR for a body that is not the documented envelope', () => {
    const err = parseErrorBody(500, { oops: 'not the right shape' })
    expect(err.code).toBe('INTERNAL_ERROR')
    expect(err.message).toBe('Something went wrong. Try again.')
  })

  it('falls back gracefully for a null/non-object body (e.g. an empty response)', () => {
    expect(parseErrorBody(500, null).code).toBe('INTERNAL_ERROR')
    expect(parseErrorBody(500, undefined).code).toBe('INTERNAL_ERROR')
  })
})

describe('fetchItemsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests /api/v1/items with limit/cursor merged onto the base filter params', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse(200, { data: [], page: { next_cursor: null, has_more: false } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchItemsPage(new URLSearchParams('kind=github&sort=newest'), {
      cursor: 'abc',
      limit: 40,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toMatch(/^\/api\/v1\/items\?/)
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('kind')).toBe('github')
    expect(params.get('sort')).toBe('newest')
    expect(params.get('limit')).toBe('40')
    expect(params.get('cursor')).toBe('abc')
    expect(init.credentials).toBe('same-origin')
  })

  it('throws ApiClientError on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } }),
      ),
    )

    await expect(fetchItemsPage(new URLSearchParams())).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    })
  })
})

describe('patchItem', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends a PATCH with a JSON body of exactly the given fields', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse(200, { id: 'itm_1', starred: true }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await patchItem('itm_1', { starred: true })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/items/itm_1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ starred: true })
  })
})

describe('retryItemStage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the requested stage and returns the queued result', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse(202, { id: 'itm_1', status: 'queued', stage: 'extract' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await retryItemStage('itm_1', 'extract')

    expect(result).toEqual({ id: 'itm_1', status: 'queued', stage: 'extract' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/items/itm_1/retry')
    expect(JSON.parse(init.body as string)).toEqual({ stage: 'extract' })
  })

  it('surfaces a 409 CONFLICT (a retry already in flight) as ApiClientError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(409, {
          error: {
            code: 'CONFLICT',
            message: 'A job for this item at this stage is already pending or running.',
          },
        }),
      ),
    )

    await expect(retryItemStage('itm_1', 'enrich')).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

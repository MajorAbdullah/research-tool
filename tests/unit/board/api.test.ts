import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ApiRequestError,
  fetchAllItems,
  fetchItemDetail,
  patchItemFields,
  patchItemStatus,
} from '@/components/board/api'
import { fakeItem } from './fixtures'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchAllItems', () => {
  it('returns a single page verbatim when has_more is false', async () => {
    const items = [fakeItem({ id: '1' }), fakeItem({ id: '2' })]
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: items, page: { next_cursor: null, has_more: false } }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllItems()

    expect(result).toEqual(items)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('loops through cursor pages (docs/API.md §1.6) until has_more is false, concatenating', async () => {
    const page1 = {
      data: [fakeItem({ id: '1' })],
      page: { next_cursor: 'CURSOR_A', has_more: true },
    }
    const page2 = { data: [fakeItem({ id: '2' })], page: { next_cursor: null, has_more: false } }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllItems()

    expect(result.map((i) => i.id)).toEqual(['1', '2'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondCallUrl = fetchMock.mock.calls[1]?.[0] as string
    expect(secondCallUrl).toContain('cursor=CURSOR_A')
  })

  it('never constructs its own cursor — it only ever forwards the previous response’s next_cursor verbatim', async () => {
    const page1 = { data: [], page: { next_cursor: 'op4que+value/here==', has_more: true } }
    const page2 = { data: [], page: { next_cursor: null, has_more: false } }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2))
    vi.stubGlobal('fetch', fetchMock)

    await fetchAllItems()

    const secondCallUrl = fetchMock.mock.calls[1]?.[0] as string
    const params = new URL(secondCallUrl, 'http://localhost').searchParams
    expect(params.get('cursor')).toBe('op4que+value/here==')
  })

  it('stops at the page safety valve rather than looping forever against a misbehaving server', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [fakeItem({ id: 'x' })],
        page: { next_cursor: 'ALWAYS', has_more: true },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllItems()

    expect(fetchMock).toHaveBeenCalledTimes(50)
    expect(result).toHaveLength(50)
  })
})

describe('error handling (docs/API.md §1.5 envelope)', () => {
  it('throws ApiRequestError carrying the parsed error envelope on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'INVALID_STATUS_TRANSITION',
              message: 'Cannot move from "inbox" to "queued".',
              details: { from: 'inbox', to: 'queued', allowed_next: ['to_test'] },
              request_id: 'req_123',
            },
          },
          400,
        ),
      ),
    )

    await expect(patchItemStatus('itm_1', 'queued')).rejects.toMatchObject({
      name: 'ApiRequestError',
      status: 400,
      code: 'INVALID_STATUS_TRANSITION',
      message: 'Cannot move from "inbox" to "queued".',
      requestId: 'req_123',
    })
  })

  it('falls back to a generic error when the body is not the documented envelope shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error('not json')),
      } as unknown as Response),
    )

    await expect(patchItemStatus('itm_1', 'inbox')).rejects.toMatchObject({
      status: 502,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Try again.',
    })
  })

  it('falls back to a generic error when the body parses but has no `error` key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ unexpected: true }, 500)))

    await expect(patchItemStatus('itm_1', 'inbox')).rejects.toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
    })
  })
})

describe('patchItemStatus', () => {
  it('PATCHes the status sub-resource with the requested status only', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(fakeItem({ id: 'itm_1', status: 'to_test' })))
    vi.stubGlobal('fetch', fetchMock)

    const result = await patchItemStatus('itm_1', 'to_test')

    expect(result.status).toBe('to_test')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/items/itm_1/status')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ status: 'to_test' })
  })
})

describe('patchItemFields', () => {
  it('sends only the fields the board edits and returns the parsed item', async () => {
    const responseBody = { ...fakeItem({ id: 'itm_1' }), outcome_note: 'Worked great' }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(responseBody))
    vi.stubGlobal('fetch', fetchMock)

    const result = await patchItemFields('itm_1', { outcome_note: 'Worked great' })

    expect(result.outcome_note).toBe('Worked great')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/items/itm_1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ outcome_note: 'Worked great' })
  })
})

describe('fetchItemDetail', () => {
  it('issues a plain GET and returns the parsed detail', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'itm_1', outcome_note: null }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchItemDetail('itm_1')

    expect(result).toEqual({ id: 'itm_1', outcome_note: null })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined]
    expect(url).toBe('/api/v1/items/itm_1')
    expect(init?.method).toBeUndefined() // GET is fetch's default; nothing overrides it
  })
})

describe('ApiRequestError', () => {
  it('carries every field from the parsed error body', () => {
    const err = new ApiRequestError(404, {
      code: 'NOT_FOUND',
      message: 'No such resource.',
      details: null,
      request_id: 'req_abc',
    })

    expect(err.status).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toBe('No such resource.')
    expect(err.requestId).toBe('req_abc')
    expect(err.name).toBe('ApiRequestError')
    expect(err).toBeInstanceOf(Error)
  })
})

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ApiError,
  buildPage,
  clampLimit,
  decodeCursor,
  encodeCursor,
  errorResponse,
  generateRequestId,
  parseJsonBody,
  parseWithSchema,
  readCappedText,
} from '@/services/http'

describe('ApiError / errorResponse', () => {
  it('maps every error code to its documented HTTP status', async () => {
    const cases: Array<[ApiError, number]> = [
      [ApiError.validation('bad'), 400],
      [ApiError.unauthorized(), 401],
      [ApiError.notFound(), 404],
      [ApiError.invalidStatusTransition('inbox', 'queued', ['to_test']), 400],
      [ApiError.conflict('busy'), 409],
      [ApiError.payloadTooLarge(), 413],
      [ApiError.rateLimited(30), 429],
      [ApiError.internal(), 500],
    ]

    for (const [err, status] of cases) {
      const res = errorResponse(err, 'req_test')
      expect(res.status).toBe(status)
      const body = (await res.json()) as { error: { code: string; request_id: string } }
      expect(body.error.request_id).toBe('req_test')
    }
  })

  it('never leaks the real message for INTERNAL_ERROR, regardless of what was thrown', async () => {
    const res = errorResponse(new Error('database file is locked at /secret/path.db'), 'req_test')
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(body.error.message).toBe('Something went wrong. Try again.')
    expect(JSON.stringify(body)).not.toMatch(/secret|\.db/)
  })

  it('sets Retry-After for a rate-limited response', () => {
    const res = errorResponse(ApiError.rateLimited(42), 'req_test')
    expect(res.headers.get('Retry-After')).toBe('42')
  })

  it('carries structured details for an invalid status transition', async () => {
    const res = errorResponse(
      ApiError.invalidStatusTransition('inbox', 'queued', ['to_test', 'dropped']),
      'req_test',
    )
    const body = (await res.json()) as {
      error: { details: { from: string; to: string; allowed_next: string[] } }
    }
    expect(body.error.details).toEqual({
      from: 'inbox',
      to: 'queued',
      allowed_next: ['to_test', 'dropped'],
    })
  })
})

describe('generateRequestId', () => {
  it('produces an opaque req_ prefixed id, unique per call', () => {
    const a = generateRequestId()
    const b = generateRequestId()
    expect(a).toMatch(/^req_/)
    expect(a).not.toBe(b)
  })
})

describe('parseWithSchema', () => {
  const schema = z.object({ url: z.string().min(1) })

  it('returns parsed data on success', () => {
    expect(parseWithSchema(schema, { url: 'https://example.com' })).toEqual({
      url: 'https://example.com',
    })
  })

  it('throws a VALIDATION_ERROR ApiError, never a raw ZodError, on failure', () => {
    try {
      parseWithSchema(schema, {})
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe('VALIDATION_ERROR')
    }
  })
})

describe('parseJsonBody', () => {
  it('parses valid JSON', () => {
    expect(parseJsonBody('{"a":1}')).toEqual({ a: 1 })
  })

  it('treats an empty body as an empty object rather than throwing', () => {
    expect(parseJsonBody('')).toEqual({})
  })

  it('throws a display-safe VALIDATION_ERROR on malformed JSON', () => {
    try {
      parseJsonBody('{not json')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe('VALIDATION_ERROR')
    }
  })
})

describe('readCappedText', () => {
  it('accepts a body under the cap', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: 'hello' })
    await expect(readCappedText(request, 1_000)).resolves.toBe('hello')
  })

  it('rejects via the declared Content-Length before reading the body', async () => {
    const request = new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-length': '999999' },
      body: 'hello',
    })
    await expect(readCappedText(request, 10)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' })
  })

  it('rejects an oversized body even without a usable Content-Length', async () => {
    const big = 'x'.repeat(2_000)
    const request = new Request('http://localhost/x', { method: 'POST', body: big })
    await expect(readCappedText(request, 100)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' })
  })
})

describe('clampLimit', () => {
  it('defaults to 20 when absent', () => {
    expect(clampLimit(null)).toBe(20)
  })

  it('clamps rather than rejects out-of-range values', () => {
    expect(clampLimit('0')).toBe(1)
    expect(clampLimit('-5')).toBe(1)
    expect(clampLimit('1000')).toBe(100)
  })

  it('falls back to the default on garbage input', () => {
    expect(clampLimit('not-a-number')).toBe(20)
  })

  it('passes a valid in-range value through unchanged', () => {
    expect(clampLimit('42')).toBe(42)
  })
})

describe('cursor encode/decode', () => {
  it('round-trips', () => {
    const cursor = { v: 1789030800000, id: 42 }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  it('round-trips a null sort value', () => {
    const cursor = { v: null, id: 7 }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  it('returns null for a malformed or tampered cursor rather than throwing', () => {
    expect(decodeCursor('not-base64-json')).toBeNull()
    expect(decodeCursor(Buffer.from('{"not":"a cursor"}').toString('base64url'))).toBeNull()
  })
})

describe('buildPage', () => {
  it('reports has_more and a next_cursor when there is an extra row past the limit', () => {
    const rows = [1, 2, 3]
    const page = buildPage(
      rows,
      2,
      (n) => ({ n }),
      (n) => ({ v: n, id: n }),
    )
    expect(page.data).toEqual([{ n: 1 }, { n: 2 }])
    expect(page.page.has_more).toBe(true)
    expect(decodeCursor(page.page.next_cursor as string)).toEqual({ v: 2, id: 2 })
  })

  it('reports has_more: false and a null cursor on the last page', () => {
    const rows = [1, 2]
    const page = buildPage(
      rows,
      2,
      (n) => ({ n }),
      (n) => ({ v: n, id: n }),
    )
    expect(page.page.has_more).toBe(false)
    expect(page.page.next_cursor).toBeNull()
  })
})

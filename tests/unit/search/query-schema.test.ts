import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { parseSearchQuery } from '@/lib/search/query-schema'

function params(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries)
}

describe('parseSearchQuery', () => {
  it('parses a bare query with defaults', () => {
    const parsed = parseSearchQuery(params({ q: 'video diffusion fine-tuning' }))
    expect(parsed.q).toBe('video diffusion fine-tuning')
    expect(parsed.tier).toBe('hybrid')
    expect(parsed.cursor).toBeUndefined()
    expect(parsed.limit).toBeUndefined()
    expect(parsed.filters).toEqual({
      kind: undefined,
      topic: undefined,
      tag: undefined,
      status: undefined,
      extractionTier: undefined,
      dateFrom: undefined,
      dateTo: undefined,
    })
  })

  it('rejects a missing q', () => {
    expect(() => parseSearchQuery(params({}))).toThrow(ZodError)
    try {
      parseSearchQuery(params({}))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ZodError)
      expect((err as ZodError).issues[0]?.message).toBe('q is required')
    }
  })

  it('rejects an empty q the same way as a missing one', () => {
    expect(() => parseSearchQuery(params({ q: '   ' }))).toThrow(ZodError)
  })

  it('parses comma-separated enum filters', () => {
    const parsed = parseSearchQuery(params({ q: 'x', kind: 'github,video', status: 'inbox' }))
    expect(parsed.filters.kind).toEqual(['github', 'video'])
    expect(parsed.filters.status).toEqual(['inbox'])
  })

  it('rejects an unknown enum value with a field-identifying error', () => {
    try {
      parseSearchQuery(params({ q: 'x', kind: 'github,not-a-kind' }))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ZodError)
      const issue = (err as ZodError).issues[0]
      expect(issue?.path).toEqual(['kind'])
      expect(issue?.message).toContain('not-a-kind')
    }
  })

  it('parses free-text tag/topic lists without enum validation', () => {
    const parsed = parseSearchQuery(params({ q: 'x', tag: 'diffusion,fine-tuning', topic: 'video-diffusion' }))
    expect(parsed.filters.tag).toEqual(['diffusion', 'fine-tuning'])
    expect(parsed.filters.topic).toEqual(['video-diffusion'])
  })

  it('parses date_from/date_to as numbers', () => {
    const parsed = parseSearchQuery(params({ q: 'x', date_from: '100', date_to: '200' }))
    expect(parsed.filters.dateFrom).toBe(100)
    expect(parsed.filters.dateTo).toBe(200)
  })

  it('rejects a non-numeric date_from', () => {
    expect(() => parseSearchQuery(params({ q: 'x', date_from: 'not-a-date' }))).toThrow(ZodError)
  })

  it('rejects a non-numeric limit', () => {
    expect(() => parseSearchQuery(params({ q: 'x', limit: 'abc' }))).toThrow(ZodError)
  })

  it('passes cursor through untouched', () => {
    expect(parseSearchQuery(params({ q: 'x', cursor: 'opaque-value' })).cursor).toBe('opaque-value')
  })

  it('accepts tier=fts, defaults to hybrid, and rejects an unknown tier', () => {
    expect(parseSearchQuery(params({ q: 'x', tier: 'fts' })).tier).toBe('fts')
    expect(parseSearchQuery(params({ q: 'x' })).tier).toBe('hybrid')
    expect(() => parseSearchQuery(params({ q: 'x', tier: 'nonsense' }))).toThrow(ZodError)
  })
})

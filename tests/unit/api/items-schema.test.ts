import { describe, expect, it } from 'vitest'
import { ApiError } from '@/services/http'
import {
  ItemPatchSchema,
  ItemRetrySchema,
  ItemStatusPatchSchema,
  parseItemsListQuery,
} from '@/services/items-schema'
import { MAX_TAGS_PER_ITEM } from '@/services/tags'

describe('ItemPatchSchema', () => {
  it('accepts every documented field, all optional', () => {
    const result = ItemPatchSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('rejects more tags than the cap (validation lives at the HTTP boundary, per CLAUDE.md)', () => {
    const result = ItemPatchSchema.safeParse({
      tags: Array.from({ length: MAX_TAGS_PER_ITEM + 1 }, (_, i) => `t${i}`),
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown field — this endpoint is not for status or outcome transitions', () => {
    const result = ItemPatchSchema.safeParse({ status: 'inbox' })
    expect(result.success).toBe(false)
  })

  it('note/outcome_note/topic accept null (clear); tags does not need to', () => {
    expect(ItemPatchSchema.safeParse({ note: null }).success).toBe(true)
    expect(ItemPatchSchema.safeParse({ outcome_note: null }).success).toBe(true)
    expect(ItemPatchSchema.safeParse({ topic: null }).success).toBe(true)
  })
})

describe('ItemStatusPatchSchema', () => {
  it('accepts every ItemStatus value', () => {
    for (const status of [
      'queued',
      'processing',
      'inbox',
      'to_test',
      'testing',
      'tested',
      'archived',
      'dropped',
      'failed',
    ]) {
      expect(ItemStatusPatchSchema.safeParse({ status }).success).toBe(true)
    }
  })

  it('rejects an unknown status value', () => {
    expect(ItemStatusPatchSchema.safeParse({ status: 'not-a-status' }).success).toBe(false)
  })
})

describe('ItemRetrySchema', () => {
  it('accepts all six JobStage values, including resolve (rejected later, at the service layer)', () => {
    for (const stage of ['resolve', 'extract', 'enrich', 'embed', 'relate', 'index']) {
      expect(ItemRetrySchema.safeParse({ stage }).success).toBe(true)
    }
  })

  it('requires stage', () => {
    expect(ItemRetrySchema.safeParse({}).success).toBe(false)
  })
})

describe('parseItemsListQuery', () => {
  it('defaults to sort=newest, limit=20, no filters', () => {
    const query = parseItemsListQuery(new URLSearchParams())
    expect(query).toEqual({
      kind: undefined,
      topic: undefined,
      status: undefined,
      tag: undefined,
      extractionTier: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      cursor: undefined,
      limit: 20,
      sort: 'newest',
    })
  })

  it('splits comma-separated enum filters and validates each value', () => {
    const query = parseItemsListQuery(new URLSearchParams('kind=github,video'))
    expect(query.kind).toEqual(['github', 'video'])
  })

  it('throws VALIDATION_ERROR for an out-of-enum filter value', () => {
    try {
      parseItemsListQuery(new URLSearchParams('kind=not-a-kind'))
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe('VALIDATION_ERROR')
    }
  })

  it('throws VALIDATION_ERROR for an unknown sort value', () => {
    expect(() => parseItemsListQuery(new URLSearchParams('sort=random'))).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    )
  })

  it('clamps limit rather than rejecting it', () => {
    expect(parseItemsListQuery(new URLSearchParams('limit=1000')).limit).toBe(100)
    expect(parseItemsListQuery(new URLSearchParams('limit=0')).limit).toBe(1)
  })

  it('parses free-text topic/tag filters without enum validation', () => {
    const query = parseItemsListQuery(
      new URLSearchParams('topic=video-diffusion&tag=quantization,fine-tuning'),
    )
    expect(query.topic).toEqual(['video-diffusion'])
    expect(query.tag).toEqual(['quantization', 'fine-tuning'])
  })
})

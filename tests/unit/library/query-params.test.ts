import { describe, expect, it } from 'vitest'
import {
  countActiveFilters,
  emptyLibraryQueryState,
  isFiltersEmpty,
  parseGroupBy,
  parseLibraryFilters,
  parseLibraryQueryState,
  serializeLibraryState,
  toApiSearchParams,
} from '@/components/library/query-params'
import type { LibraryQueryState } from '@/components/library/types'

describe('parseLibraryQueryState', () => {
  it('defaults to an empty, unfiltered, newest-first state on an empty query string', () => {
    const state = parseLibraryQueryState(new URLSearchParams())
    expect(state).toEqual(emptyLibraryQueryState())
  })

  it('parses q, csv filters, and enum filters', () => {
    const params = new URLSearchParams(
      'q=video+diffusion&kind=github,video&status=inbox,to_test&extraction_tier=full&topic=rag-evals&tag=fine-tuning,llm',
    )
    const state = parseLibraryQueryState(params)
    expect(state.q).toBe('video diffusion')
    expect(state.filters.kind).toEqual(['github', 'video'])
    expect(state.filters.status).toEqual(['inbox', 'to_test'])
    expect(state.filters.extractionTier).toEqual(['full'])
    expect(state.filters.topic).toEqual(['rag-evals'])
    expect(state.filters.tag).toEqual(['fine-tuning', 'llm'])
  })

  it('trims whitespace around q', () => {
    expect(parseLibraryQueryState(new URLSearchParams('q=%20hello%20')).q).toBe('hello')
  })

  it('drops unknown enum values instead of throwing', () => {
    const state = parseLibraryQueryState(new URLSearchParams('kind=github,bogus,video'))
    expect(state.filters.kind).toEqual(['github', 'video'])
  })

  it('dedupes repeated values within a csv filter', () => {
    const state = parseLibraryQueryState(new URLSearchParams('kind=github,github,video'))
    expect(state.filters.kind).toEqual(['github', 'video'])
  })

  it('parses date_from/date_to as epoch-ms numbers, ignoring non-numeric junk', () => {
    const good = parseLibraryQueryState(new URLSearchParams('date_from=1000&date_to=2000'))
    expect(good.filters.dateFrom).toBe(1000)
    expect(good.filters.dateTo).toBe(2000)

    const bad = parseLibraryQueryState(new URLSearchParams('date_from=not-a-number'))
    expect(bad.filters.dateFrom).toBeUndefined()
  })

  it('falls back to newest for a missing or invalid sort value', () => {
    expect(parseLibraryQueryState(new URLSearchParams()).sort).toBe('newest')
    expect(parseLibraryQueryState(new URLSearchParams('sort=bogus')).sort).toBe('newest')
    expect(parseLibraryQueryState(new URLSearchParams('sort=recently_opened')).sort).toBe(
      'recently_opened',
    )
  })

  it('rejects most_related — that value belongs to the wider API enum, not this UI', () => {
    expect(parseLibraryQueryState(new URLSearchParams('sort=most_related')).sort).toBe('newest')
  })
})

describe('parseGroupBy', () => {
  it('defaults to none', () => {
    expect(parseGroupBy(new URLSearchParams())).toBe('none')
  })

  it('parses each valid value and rejects unknown ones', () => {
    for (const value of ['none', 'kind', 'topic', 'status', 'date']) {
      expect(parseGroupBy(new URLSearchParams(`group=${value}`))).toBe(value)
    }
    expect(parseGroupBy(new URLSearchParams('group=bogus'))).toBe('none')
  })
})

describe('serializeLibraryState', () => {
  it('produces an empty query string for the default state (no cruft for the common case)', () => {
    expect(serializeLibraryState(emptyLibraryQueryState()).toString()).toBe('')
  })

  it('round-trips through parse -> serialize -> parse', () => {
    const original = new URLSearchParams(
      'q=agentic+rag&kind=github,video&status=inbox&extraction_tier=partial,metadata_only&topic=rag-evals&tag=eval&date_from=1000&date_to=2000&sort=oldest&group=topic',
    )
    const state = parseLibraryQueryState(original)
    const group = parseGroupBy(original)
    const serialized = serializeLibraryState(state, group)
    const reparsed = parseLibraryQueryState(serialized)
    const regroup = parseGroupBy(serialized)

    expect(reparsed).toEqual(state)
    expect(regroup).toBe(group)
  })

  it('omits group when it is the default', () => {
    const state = emptyLibraryQueryState()
    expect(serializeLibraryState(state, 'none').has('group')).toBe(false)
    expect(serializeLibraryState(state, 'kind').get('group')).toBe('kind')
  })
})

describe('toApiSearchParams', () => {
  it('always writes an explicit sort, even when it is the default', () => {
    const params = toApiSearchParams(emptyLibraryQueryState())
    expect(params.get('sort')).toBe('newest')
  })

  it('never includes group — the API has no such param', () => {
    const params = toApiSearchParams(emptyLibraryQueryState())
    expect(params.has('group')).toBe(false)
  })

  it('includes q when present (needed for the search endpoint)', () => {
    const state: LibraryQueryState = { ...emptyLibraryQueryState(), q: 'vllm' }
    expect(toApiSearchParams(state).get('q')).toBe('vllm')
  })

  it('omits q when empty (browse mode never sends it)', () => {
    expect(toApiSearchParams(emptyLibraryQueryState()).has('q')).toBe(false)
  })
})

describe('isFiltersEmpty / countActiveFilters', () => {
  it('treats the empty-filters value as empty with a zero count', () => {
    const filters = parseLibraryFilters(new URLSearchParams())
    expect(isFiltersEmpty(filters)).toBe(true)
    expect(countActiveFilters(filters)).toBe(0)
  })

  it('counts each csv entry across filter dimensions, and the date range as one unit', () => {
    const filters = parseLibraryFilters(
      new URLSearchParams('kind=github,video&status=inbox&date_from=1000'),
    )
    expect(isFiltersEmpty(filters)).toBe(false)
    // 2 kinds + 1 status + 1 (date range, counted once even though only one bound is set)
    expect(countActiveFilters(filters)).toBe(4)
  })
})

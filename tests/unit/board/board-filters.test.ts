import { describe, expect, it } from 'vitest'

import {
  applyFilters,
  collectTopics,
  hasActiveFilters,
  matchesFilters,
} from '@/components/board/board-filters'
import { fakeItem as item } from './fixtures'

describe('matchesFilters', () => {
  it('matches everything when no filter is set', () => {
    expect(matchesFilters(item({ id: '1' }), { kind: null, topic: null })).toBe(true)
  })

  it('filters by kind', () => {
    const repo = item({ id: '1', kind: 'github' })
    const video = item({ id: '2', kind: 'video' })
    expect(matchesFilters(repo, { kind: 'github', topic: null })).toBe(true)
    expect(matchesFilters(video, { kind: 'github', topic: null })).toBe(false)
  })

  it('filters by topic slug', () => {
    const withTopic = item({
      id: '1',
      topic: { slug: 'rag', label: 'RAG', color: '#000', confidence: 1 },
    })
    const withoutTopic = item({ id: '2', topic: null })
    expect(matchesFilters(withTopic, { kind: null, topic: 'rag' })).toBe(true)
    expect(matchesFilters(withTopic, { kind: null, topic: 'other' })).toBe(false)
    expect(matchesFilters(withoutTopic, { kind: null, topic: 'rag' })).toBe(false)
  })

  it('combines kind and topic with AND', () => {
    const match = item({
      id: '1',
      kind: 'github',
      topic: { slug: 'rag', label: 'RAG', color: '#000', confidence: 1 },
    })
    const wrongKind = item({
      id: '2',
      kind: 'video',
      topic: { slug: 'rag', label: 'RAG', color: '#000', confidence: 1 },
    })
    const filters = { kind: 'github' as const, topic: 'rag' }
    expect(matchesFilters(match, filters)).toBe(true)
    expect(matchesFilters(wrongKind, filters)).toBe(false)
  })
})

describe('applyFilters', () => {
  it('narrows the list to only matching items — "only repos in To Test"', () => {
    const items = [
      item({ id: '1', kind: 'github', status: 'to_test' }),
      item({ id: '2', kind: 'video', status: 'to_test' }),
      item({ id: '3', kind: 'github', status: 'testing' }),
    ]
    const result = applyFilters(items, { kind: 'github', topic: null })
    expect(result.map((i) => i.id)).toEqual(['1', '3'])
  })
})

describe('hasActiveFilters', () => {
  it('is false when both filters are null', () => {
    expect(hasActiveFilters({ kind: null, topic: null })).toBe(false)
  })

  it('is true when either filter is set', () => {
    expect(hasActiveFilters({ kind: 'github', topic: null })).toBe(true)
    expect(hasActiveFilters({ kind: null, topic: 'rag' })).toBe(true)
  })
})

describe('collectTopics', () => {
  it('dedupes by slug and sorts by label', () => {
    const items = [
      item({ id: '1', topic: { slug: 'zebra', label: 'Zebra', color: '#000', confidence: 1 } }),
      item({ id: '2', topic: { slug: 'apple', label: 'Apple', color: '#000', confidence: 1 } }),
      item({ id: '3', topic: { slug: 'apple', label: 'Apple', color: '#000', confidence: 1 } }),
      item({ id: '4', topic: null }),
    ]
    expect(collectTopics(items)).toEqual([
      { slug: 'apple', label: 'Apple' },
      { slug: 'zebra', label: 'Zebra' },
    ])
  })

  it('is empty when nothing has a topic', () => {
    expect(collectTopics([item({ id: '1', topic: null })])).toEqual([])
  })
})

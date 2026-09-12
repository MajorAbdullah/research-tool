import { describe, expect, it } from 'vitest'
import { buildItemFilterFragment } from '@/lib/search/filters'
import { ItemKind, ItemStatus } from '@/types/contracts'

describe('buildItemFilterFragment', () => {
  it('is empty when there are no filters', () => {
    expect(buildItemFilterFragment({})).toEqual({ sql: '', params: [] })
  })

  it('builds an IN clause for kind', () => {
    const fragment = buildItemFilterFragment({ kind: [ItemKind.Github, ItemKind.Video] })
    expect(fragment.sql).toBe(' AND items.kind IN (?,?)')
    expect(fragment.params).toEqual(['github', 'video'])
  })

  it('combines multiple filter kinds with AND, each an internal OR via IN', () => {
    const fragment = buildItemFilterFragment({
      kind: [ItemKind.Github],
      status: [ItemStatus.Inbox, ItemStatus.Tested],
    })
    expect(fragment.sql).toBe(' AND items.kind IN (?) AND items.status IN (?,?)')
    expect(fragment.params).toEqual(['github', 'inbox', 'tested'])
  })

  it('builds inclusive date range bounds', () => {
    const fragment = buildItemFilterFragment({ dateFrom: 100, dateTo: 200 })
    expect(fragment.sql).toBe(' AND items.created_at >= ? AND items.created_at <= ?')
    expect(fragment.params).toEqual([100, 200])
  })

  it('builds a tag EXISTS subquery', () => {
    const fragment = buildItemFilterFragment({ tag: ['diffusion', 'fine-tuning'] })
    expect(fragment.sql).toContain('EXISTS (SELECT 1 FROM item_tags it JOIN tags t')
    expect(fragment.sql).toContain('t.label IN (?,?)')
    expect(fragment.params).toEqual(['diffusion', 'fine-tuning'])
  })

  it('builds a topic EXISTS subquery', () => {
    const fragment = buildItemFilterFragment({ topic: ['video-diffusion'] })
    expect(fragment.sql).toContain('EXISTS (SELECT 1 FROM item_topics itp JOIN topics tp')
    expect(fragment.sql).toContain('tp.slug IN (?)')
    expect(fragment.params).toEqual(['video-diffusion'])
  })

  it('ignores empty filter arrays the same as omitted filters', () => {
    expect(buildItemFilterFragment({ kind: [], tag: [], topic: [] })).toEqual({
      sql: '',
      params: [],
    })
  })
})

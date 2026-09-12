import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createScratchDb } from '../test-helpers/scratch-db'
import { makeUser, makeItem, tagItem } from '../../helpers/factories'
import { toItemId } from '@/services/ids'
import { ApiError } from '@/services/http'
import {
  STATUS_TRANSITIONS,
  getItemDetail,
  listItems,
  patchItem,
  patchItemStatus,
  retryItem,
} from '@/services/items-service'
import type { ItemsListQuery } from '@/services/items-schema'
import type { ItemStatus } from '@/types/contracts'

type Db = ReturnType<typeof createScratchDb>

let db: Db

beforeAll(() => {
  db = createScratchDb()
  globalThis.__sieveSqlite = db
  makeUser(db, 1)
  makeUser(db, 2)
})

afterAll(() => {
  db.close()
  globalThis.__sieveSqlite = undefined
})

beforeEach(() => {
  db.exec(
    'delete from jobs; delete from item_tags; delete from item_topics; delete from tags; delete from topics; delete from relations; delete from items;',
  )
})

const baseQuery: ItemsListQuery = { limit: 20, sort: 'newest' }

describe('STATUS_TRANSITIONS', () => {
  it('matches docs/API.md §3.6 exactly', () => {
    expect(STATUS_TRANSITIONS).toEqual({
      queued: [],
      processing: [],
      inbox: ['to_test', 'testing', 'tested', 'archived', 'dropped'],
      to_test: ['inbox', 'testing', 'tested', 'archived', 'dropped'],
      testing: ['inbox', 'to_test', 'tested', 'archived', 'dropped'],
      tested: ['inbox', 'to_test', 'testing', 'archived', 'dropped'],
      archived: ['inbox'],
      dropped: ['inbox'],
      failed: [],
    })
  })
})

describe('patchItemStatus', () => {
  it('allows a documented transition and returns the updated item', () => {
    const id = makeItem(db, { id: 1, status: 'inbox' })
    const result = patchItemStatus(1, toItemId(id), 'testing')
    expect(result.status).toBe('testing')
  })

  it('rejects an undocumented transition with INVALID_STATUS_TRANSITION and the allowed set', () => {
    const id = makeItem(db, { id: 2, status: 'archived' })
    try {
      patchItemStatus(1, toItemId(id), 'testing')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError
      expect(apiErr.code).toBe('INVALID_STATUS_TRANSITION')
      expect(apiErr.details).toEqual({ from: 'archived', to: 'testing', allowed_next: ['inbox'] })
    }
  })

  it('never allows a transition into a pipeline-owned status', () => {
    const id = makeItem(db, { id: 3, status: 'inbox' })
    expect(() => patchItemStatus(1, toItemId(id), 'queued' as ItemStatus)).toThrow(ApiError)
  })

  it('is a 404 for an item belonging to another user — indistinguishable from a bad id', () => {
    const theirs = makeItem(db, { id: 4, userId: 2, status: 'inbox' })
    try {
      patchItemStatus(1, toItemId(theirs), 'testing')
      expect.unreachable()
    } catch (err) {
      expect((err as ApiError).code).toBe('NOT_FOUND')
    }
  })

  it('404s for a malformed id without throwing anything else', () => {
    expect(() => patchItemStatus(1, 'not-an-id', 'testing')).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    )
  })
})

describe('patchItem', () => {
  it('updates note/starred and leaves omitted fields untouched', () => {
    const id = makeItem(db, { id: 10, title: 'Original' })
    const result = patchItem(1, toItemId(id), { note: 'hello', starred: true })
    expect(result.note).toBe('hello')
    expect(result.starred).toBe(true)
    expect(result.title).toBe('Original')
  })

  it('clears note with an explicit null', () => {
    const id = makeItem(db, { id: 11 })
    patchItem(1, toItemId(id), { note: 'first' })
    const result = patchItem(1, toItemId(id), { note: null })
    expect(result.note).toBeNull()
  })

  it('tags is a full replacement, not a merge', () => {
    const id = makeItem(db, { id: 12 })
    tagItem(db, id, 'keep-me-out')
    const result = patchItem(1, toItemId(id), { tags: ['a', 'b'] })
    expect(result.tags.sort()).toEqual(['a', 'b'])
  })

  it('setting topic creates it (if needed) and makes it primary with confidence 1', () => {
    const id = makeItem(db, { id: 14 })
    const result = patchItem(1, toItemId(id), { topic: 'video-diffusion' })
    expect(result.topic).toMatchObject({
      slug: 'video-diffusion',
      label: 'Video Diffusion',
      confidence: 1,
    })
  })

  it('clearing a manual override reverts to the AI-assigned topic underneath it', () => {
    const id = makeItem(db, { id: 15 })
    // Simulate enrichment having already assigned a topic at a lower confidence.
    db.prepare(
      `insert into topics (id, user_id, slug, label) values (100, 1, 'ai-topic', 'AI Topic')`,
    ).run()
    db.prepare(`insert into item_topics (item_id, topic_id, confidence) values (?, 100, 0.8)`).run(
      id,
    )

    const overridden = patchItem(1, toItemId(id), { topic: 'manual-topic' })
    expect(overridden.topic?.slug).toBe('manual-topic')

    const reverted = patchItem(1, toItemId(id), { topic: null })
    expect(reverted.topic?.slug).toBe('ai-topic')
    expect(reverted.topic?.confidence).toBe(0.8)
  })
})

describe('getItemDetail', () => {
  it('surfaces a null extraction_tier as metadata_only, never a bare null', () => {
    const id = makeItem(db, { id: 20 })
    db.prepare('update items set extraction_tier = NULL where id = ?').run(id)
    const item = getItemDetail(1, toItemId(id))
    expect(item.extraction_tier).toBe('metadata_only')
  })

  it('includes github kind_fields when present', () => {
    const id = makeItem(db, { id: 21, kind: 'github' })
    db.prepare('update items set kind_fields = ? where id = ?').run(
      JSON.stringify({
        language: 'TypeScript',
        stars: 120,
        license: 'MIT',
        lastCommit: 123,
        whatItDoes: 'x',
        primaryUseCase: 'y',
      }),
      id,
    )
    const item = getItemDetail(1, toItemId(id))
    expect(item.kind_fields).toEqual({
      language: 'TypeScript',
      stars: 120,
      license: 'MIT',
      last_commit: 123,
      what_it_does: 'x',
      primary_use_case: 'y',
    })
  })

  it('assembles relations from both directions with the other item’s summary', () => {
    const a = makeItem(db, { id: 22, title: 'Item A' })
    const b = makeItem(db, { id: 23, title: 'Item B', kind: 'video' })
    db.prepare(
      'insert into relations (item_a, item_b, type, score, rationale) values (?,?,?,?,?)',
    ).run(a, b, 'similar', 0.9, 'both cover the same technique')

    const detail = getItemDetail(1, toItemId(a))
    expect(detail.relations).toEqual([
      {
        item_id: toItemId(b),
        title: 'Item B',
        kind: 'video',
        type: 'similar',
        rationale: 'both cover the same technique',
        score: 0.9,
      },
    ])
  })
})

describe('listItems', () => {
  it('paginates with a cursor, newest first, without skipping or repeating rows', () => {
    const ids = [30, 31, 32, 33, 34].map((id) =>
      makeItem(db, { id, url: `https://example.test/${id}` }),
    )
    // Distinct created_at so ordering is unambiguous.
    ids.forEach((id, i) =>
      db.prepare('update items set created_at = ? where id = ?').run(1000 + i, id),
    )

    const page1 = listItems(1, { ...baseQuery, limit: 2 })
    expect(page1.data.map((d) => d.id)).toEqual([toItemId(34), toItemId(33)])
    expect(page1.page.has_more).toBe(true)

    const page2 = listItems(1, {
      ...baseQuery,
      limit: 2,
      cursor: page1.page.next_cursor ?? undefined,
    })
    expect(page2.data.map((d) => d.id)).toEqual([toItemId(32), toItemId(31)])

    const page3 = listItems(1, {
      ...baseQuery,
      limit: 2,
      cursor: page2.page.next_cursor ?? undefined,
    })
    expect(page3.data.map((d) => d.id)).toEqual([toItemId(30)])
    expect(page3.page.has_more).toBe(false)
    expect(page3.page.next_cursor).toBeNull()
  })

  it('filters by kind and status, combined with AND', () => {
    makeItem(db, { id: 40, kind: 'github', status: 'inbox' })
    makeItem(db, { id: 41, kind: 'video', status: 'inbox' })
    makeItem(db, { id: 42, kind: 'github', status: 'tested' })

    const result = listItems(1, { ...baseQuery, kind: ['github'], status: ['inbox'] })
    expect(result.data.map((d) => d.id)).toEqual([toItemId(40)])
  })

  it('never returns another user’s items', () => {
    makeItem(db, { id: 50, userId: 1 })
    makeItem(db, { id: 51, userId: 2 })
    const result = listItems(1, baseQuery)
    expect(result.data).toHaveLength(1)
    expect(result.data[0]?.id).toBe(toItemId(50))
  })

  it('sort=oldest reverses the order', () => {
    const a = makeItem(db, { id: 60 })
    const b = makeItem(db, { id: 61 })
    db.prepare('update items set created_at = 1000 where id = ?').run(a)
    db.prepare('update items set created_at = 2000 where id = ?').run(b)
    const result = listItems(1, { ...baseQuery, sort: 'oldest' })
    expect(result.data.map((d) => d.id)).toEqual([toItemId(a), toItemId(b)])
  })
})

describe('retryItem', () => {
  it('rejects stage "resolve" — it has no itemId slot to retry against', () => {
    const id = makeItem(db, { id: 70 })
    expect(() => retryItem(1, toItemId(id), { stage: 'resolve' })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    )
  })

  it('enqueues the named stage and moves the item back to queued', () => {
    const id = makeItem(db, { id: 71, status: 'tested' })
    const result = retryItem(1, toItemId(id), { stage: 'enrich' })
    expect(result).toEqual({ id: toItemId(id), status: 'queued', stage: 'enrich' })

    const job = db.prepare('select name, payload from jobs').get() as {
      name: string
      payload: string
    }
    expect(job.name).toBe('enrich')
    expect(JSON.parse(job.payload)).toEqual({ name: 'enrich', itemId: id })
  })

  it('409s when a job for this item+stage is already queued or active', () => {
    const id = makeItem(db, { id: 72 })
    retryItem(1, toItemId(id), { stage: 'extract' })
    expect(() => retryItem(1, toItemId(id), { stage: 'extract' })).toThrow(
      expect.objectContaining({ code: 'CONFLICT' }),
    )
  })

  it('a fresh transcript on retry overwrites the stored client capture and is forwarded as the hint', () => {
    const id = makeItem(db, { id: 73 })
    retryItem(1, toItemId(id), { stage: 'extract', transcript: 'first pass' })
    // First job is still queued/active, so retrying the SAME stage again would 409 — complete it
    // first to simulate the pipeline having picked it up.
    db.prepare(`update jobs set state = 'completed'`).run()

    retryItem(1, toItemId(id), { stage: 'extract', caption: 'a caption, transcript still applies' })

    const jobs = db.prepare('select payload from jobs order by id').all() as { payload: string }[]
    const latest = JSON.parse(jobs[jobs.length - 1]?.payload ?? '{}') as {
      hint?: { transcript?: string; caption?: string }
    }
    expect(latest.hint?.transcript).toBe('first pass')
    expect(latest.hint?.caption).toBe('a caption, transcript still applies')
  })
})

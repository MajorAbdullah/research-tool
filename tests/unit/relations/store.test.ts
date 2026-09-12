import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { storeLabeledRelations } from '@/lib/relations/store'
import { similarityFromDistance } from '@/lib/relations/neighbors'
import type { LabeledPair } from '@/lib/relations/labeling'
import { makeTestDb, type TestDb } from '../../helpers/db'
import { makeUser, makeItem } from '../../helpers/factories'

describe('storeLabeledRelations', () => {
  let db: TestDb
  beforeEach(() => {
    db = makeTestDb()
    makeUser(db, 1)
    makeItem(db, { id: 1 })
    makeItem(db, { id: 2 })
  })
  afterEach(() => db.close())

  function labeled(overrides: Partial<LabeledPair> = {}): LabeledPair {
    return { itemA: 1, itemB: 2, type: 'similar', rationale: 'because reasons', distance: 0.2, ...overrides }
  }

  it('inserts a labeled pair with a distance-derived score', () => {
    const result = storeLabeledRelations(db, [labeled({ distance: 0 })])
    expect(result).toEqual({ inserted: 1, skipped: 0 })

    const row = db.prepare('select * from relations where item_a=1 and item_b=2').get() as {
      type: string
      score: number
      rationale: string
    }
    expect(row.type).toBe('similar')
    expect(row.score).toBe(similarityFromDistance(0))
    expect(row.rationale).toBe('because reasons')
  })

  it('skips (does not throw on) a duplicate pair+type', () => {
    storeLabeledRelations(db, [labeled()])
    const result = storeLabeledRelations(db, [labeled({ rationale: 'a different rationale' })])
    expect(result).toEqual({ inserted: 0, skipped: 1 })
    expect(db.prepare('select count(*) c from relations').get()).toEqual({ c: 1 })
  })

  it('allows the same pair with a different type (a separate row)', () => {
    storeLabeledRelations(db, [labeled({ type: 'similar' })])
    const result = storeLabeledRelations(db, [labeled({ type: 'alternative' })])
    expect(result).toEqual({ inserted: 1, skipped: 0 })
    expect(db.prepare('select count(*) c from relations').get()).toEqual({ c: 2 })
  })

  it('inserts multiple distinct pairs in one call', () => {
    makeItem(db, { id: 3 })
    const result = storeLabeledRelations(db, [labeled(), labeled({ itemA: 1, itemB: 3 })])
    expect(result).toEqual({ inserted: 2, skipped: 0 })
  })

  it('continues past a constraint failure to insert the rest of the batch', () => {
    storeLabeledRelations(db, [labeled()]) // pre-existing row -> next call's first entry collides
    makeItem(db, { id: 3 })
    const result = storeLabeledRelations(db, [labeled(), labeled({ itemA: 1, itemB: 3 })])
    expect(result).toEqual({ inserted: 1, skipped: 1 })
  })

  it('handles an empty batch', () => {
    expect(storeLabeledRelations(db, [])).toEqual({ inserted: 0, skipped: 0 })
  })
})

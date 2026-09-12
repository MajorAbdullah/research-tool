import { describe, expect, it } from 'vitest'

import {
  STATUS_TRANSITIONS,
  allowedNextStatuses,
  canDropOnColumn,
  commonAllowedNextStatuses,
  isValidTransition,
} from '@/components/board/status-transitions'
import type { ItemStatus } from '@/components/board/board-types'

describe('STATUS_TRANSITIONS', () => {
  it('matches docs/API.md §3.6 exactly — pipeline-owned statuses have no outgoing edges', () => {
    expect(STATUS_TRANSITIONS.queued).toEqual([])
    expect(STATUS_TRANSITIONS.processing).toEqual([])
    expect(STATUS_TRANSITIONS.failed).toEqual([])
  })

  it('the four board columns are freely interchangeable in any direction', () => {
    expect(STATUS_TRANSITIONS.inbox).toEqual([
      'to_test',
      'testing',
      'tested',
      'archived',
      'dropped',
    ])
    expect(STATUS_TRANSITIONS.to_test).toEqual([
      'inbox',
      'testing',
      'tested',
      'archived',
      'dropped',
    ])
    expect(STATUS_TRANSITIONS.testing).toEqual([
      'inbox',
      'to_test',
      'tested',
      'archived',
      'dropped',
    ])
    expect(STATUS_TRANSITIONS.tested).toEqual([
      'inbox',
      'to_test',
      'testing',
      'archived',
      'dropped',
    ])
  })

  it('archived/dropped restore only to inbox, never directly back into another board column', () => {
    expect(STATUS_TRANSITIONS.archived).toEqual(['inbox'])
    expect(STATUS_TRANSITIONS.dropped).toEqual(['inbox'])
  })
})

describe('isValidTransition', () => {
  it('allows every documented edge', () => {
    expect(isValidTransition('inbox', 'to_test')).toBe(true)
    expect(isValidTransition('testing', 'inbox')).toBe(true)
    expect(isValidTransition('archived', 'inbox')).toBe(true)
    expect(isValidTransition('dropped', 'inbox')).toBe(true)
  })

  it('rejects a status transitioning to itself — there are no self-edges in the graph', () => {
    expect(isValidTransition('inbox', 'inbox')).toBe(false)
    expect(isValidTransition('tested', 'tested')).toBe(false)
  })

  it('rejects moving out of archived/dropped to anything but inbox', () => {
    expect(isValidTransition('archived', 'testing')).toBe(false)
    expect(isValidTransition('archived', 'to_test')).toBe(false)
    expect(isValidTransition('archived', 'tested')).toBe(false)
    expect(isValidTransition('archived', 'dropped')).toBe(false)
    expect(isValidTransition('dropped', 'archived')).toBe(false)
  })

  it('rejects every pipeline-owned status as a source — the board can never move these directly', () => {
    for (const from of ['queued', 'processing', 'failed'] as const) {
      for (const to of Object.keys(STATUS_TRANSITIONS) as ItemStatus[]) {
        expect(isValidTransition(from, to)).toBe(false)
      }
    }
  })

  it('rejects any board column transitioning into a pipeline-owned status', () => {
    for (const from of ['inbox', 'to_test', 'testing', 'tested', 'archived', 'dropped'] as const) {
      expect(isValidTransition(from, 'queued')).toBe(false)
      expect(isValidTransition(from, 'processing')).toBe(false)
      expect(isValidTransition(from, 'failed')).toBe(false)
    }
  })
})

describe('allowedNextStatuses', () => {
  it('returns exactly the same array STATUS_TRANSITIONS holds for that status', () => {
    expect(allowedNextStatuses('inbox')).toBe(STATUS_TRANSITIONS.inbox)
  })
})

describe('canDropOnColumn', () => {
  // Regression coverage for a real bug caught while building the drag controller: a transition
  // table has no self-edges (STATUS_TRANSITIONS.inbox does not list "inbox"), so a naive
  // "is this column reachable from the drag's origin status" check said NO for a card's own
  // column — which would have dimmed the column a card is being dragged *within* and silently
  // broken same-column manual reordering via drag.
  it('always allows a column the dragged item is already in — reordering is not a transition', () => {
    expect(canDropOnColumn('inbox', 'inbox')).toBe(true)
    expect(canDropOnColumn('to_test', 'to_test')).toBe(true)
    expect(canDropOnColumn('testing', 'testing')).toBe(true)
    expect(canDropOnColumn('tested', 'tested')).toBe(true)
    expect(canDropOnColumn('archived', 'archived_dropped')).toBe(true)
    expect(canDropOnColumn('dropped', 'archived_dropped')).toBe(true)
  })

  it('allows a column when at least one of its backing statuses is reachable', () => {
    expect(canDropOnColumn('inbox', 'archived_dropped')).toBe(true) // inbox -> archived is legal
    expect(canDropOnColumn('inbox', 'to_test')).toBe(true)
  })

  it('refuses moving an archived/dropped card anywhere but Inbox', () => {
    expect(canDropOnColumn('archived', 'to_test')).toBe(false)
    expect(canDropOnColumn('archived', 'testing')).toBe(false)
    expect(canDropOnColumn('archived', 'tested')).toBe(false)
    expect(canDropOnColumn('dropped', 'to_test')).toBe(false)
    expect(canDropOnColumn('archived', 'inbox')).toBe(true)
    expect(canDropOnColumn('dropped', 'inbox')).toBe(true)
  })

  it('refuses every pipeline-owned status as a drag origin against any board column', () => {
    for (const column of ['inbox', 'to_test', 'testing', 'tested', 'archived_dropped'] as const) {
      expect(canDropOnColumn('queued', column)).toBe(false)
      expect(canDropOnColumn('processing', column)).toBe(false)
      expect(canDropOnColumn('failed', column)).toBe(false)
    }
  })
})

describe('commonAllowedNextStatuses', () => {
  it('is empty for an empty selection', () => {
    expect(commonAllowedNextStatuses([])).toEqual([])
  })

  it('matches the single status list when everything selected shares one status', () => {
    expect(commonAllowedNextStatuses(['inbox', 'inbox']).sort()).toEqual(
      [...STATUS_TRANSITIONS.inbox].sort(),
    )
  })

  it('intersects across a mixed selection of two active board statuses', () => {
    // testing -> [inbox, to_test, tested, archived, dropped]
    // to_test -> [inbox, testing, tested, archived, dropped]
    // intersection: inbox, tested, archived, dropped ("to_test" and "testing" each drop out
    // because a status's own transition list never contains itself)
    expect(commonAllowedNextStatuses(['testing', 'to_test']).sort()).toEqual(
      ['archived', 'dropped', 'inbox', 'tested'].sort(),
    )
  })

  it('is empty when the selection mixes a shelved item with an active one — no shared legal target', () => {
    // archived -> [inbox] only; inbox -> [to_test, testing, tested, archived, dropped] (no "inbox").
    // Nothing is in both lists, so a bulk action across this exact mix has no valid common move —
    // this is correct, expected behavior (see bulk-action-bar.tsx's fallback message), not a bug.
    expect(commonAllowedNextStatuses(['inbox', 'archived'])).toEqual([])
  })

  it('is empty when any selected item is pipeline-owned', () => {
    expect(commonAllowedNextStatuses(['inbox', 'queued'])).toEqual([])
  })
})

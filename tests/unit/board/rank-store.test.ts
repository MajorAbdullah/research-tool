import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearRank, effectiveRank, persistRank } from '@/components/board/rank-store'

/**
 * `rank-store.ts` reads the bare `localStorage` global (not `window.localStorage`) specifically
 * so a test can stub just that, without faking an entire `window` — see that file's own comment.
 * vitest's default `environment: 'node'` has no real `localStorage`, so every test here supplies
 * one.
 */
class FakeStorage implements Storage {
  private store = new Map<string, string>()
  get length(): number {
    return this.store.size
  }
  clear(): void {
    this.store.clear()
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

let fakeStorage: FakeStorage

beforeEach(() => {
  fakeStorage = new FakeStorage()
  vi.stubGlobal('localStorage', fakeStorage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('effectiveRank', () => {
  it('returns the server rank when no override has been recorded', () => {
    expect(effectiveRank('itm_1', 42)).toBe(42)
    expect(effectiveRank('itm_1', null)).toBeNull()
  })

  it('returns the local override once one is persisted, even over a non-null server rank', () => {
    persistRank('itm_1', 7)
    expect(effectiveRank('itm_1', 42)).toBe(7)
    expect(effectiveRank('itm_1', null)).toBe(7)
  })

  it('only affects the item it was recorded for', () => {
    persistRank('itm_1', 7)
    expect(effectiveRank('itm_2', 42)).toBe(42)
  })
})

describe('persistRank / clearRank', () => {
  it('clearing a rank falls back to the server value again', () => {
    persistRank('itm_1', 7)
    clearRank('itm_1')
    expect(effectiveRank('itm_1', 42)).toBe(42)
  })

  it('clearing an id with no override is a harmless no-op', () => {
    expect(() => clearRank('never-set')).not.toThrow()
  })

  it('survives across separate calls via the same backing storage (simulating a reload)', () => {
    persistRank('itm_1', 100)
    // A fresh read (as a reload would do) still sees it, because it went through localStorage,
    // not an in-memory variable.
    expect(effectiveRank('itm_1', null)).toBe(100)
  })
})

describe('defensive parsing', () => {
  it('treats corrupted JSON already in storage as "no overrides" rather than throwing', () => {
    fakeStorage.setItem('sieve-board-rank-overrides', 'not valid json{{{')
    expect(() => effectiveRank('itm_1', 5)).not.toThrow()
    expect(effectiveRank('itm_1', 5)).toBe(5)
  })

  it('ignores non-numeric entries written by some other version rather than surfacing them', () => {
    fakeStorage.setItem(
      'sieve-board-rank-overrides',
      JSON.stringify({ itm_1: 'not-a-number', itm_2: 12 }),
    )
    expect(effectiveRank('itm_1', 5)).toBe(5)
    expect(effectiveRank('itm_2', 999)).toBe(12)
  })

  it('treats a JSON array (not an object) already in storage as "no overrides"', () => {
    fakeStorage.setItem('sieve-board-rank-overrides', JSON.stringify([1, 2, 3]))
    expect(effectiveRank('itm_1', 5)).toBe(5)
  })
})

describe('a storage that throws (private browsing / quota exceeded)', () => {
  it('persistRank never throws even if the underlying setItem does', () => {
    const throwingStorage: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    vi.stubGlobal('localStorage', throwingStorage)
    expect(() => persistRank('itm_1', 1)).not.toThrow()
  })

  it('effectiveRank never throws even if the underlying getItem does', () => {
    const throwingStorage: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {},
    }
    vi.stubGlobal('localStorage', throwingStorage)
    expect(() => effectiveRank('itm_1', 5)).not.toThrow()
    expect(effectiveRank('itm_1', 5)).toBe(5)
  })
})

import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { BudgetManager } from '@/lib/ai/budget'
import { createInMemorySettingsPort, createSqliteSettingsPort } from '@/lib/ai/settings-store'

const DAY_MS = 24 * 60 * 60 * 1000

describe('BudgetManager (in-memory settings port — pure logic)', () => {
  it('reserves requests for both lanes while under their limits', () => {
    const store = createInMemorySettingsPort()
    const budget = new BudgetManager(store, 10, 3, () => Date.parse('2026-09-12T00:00:00Z'))

    const r1 = budget.reserve('background')
    expect(r1).toEqual({ ok: true, lane: 'background', remaining: 6 }) // limit 7 (10-3), used 1 -> remaining 6
  })

  it('stops background usage at dailyCap - interactiveReserve, while interactive keeps going', () => {
    const store = createInMemorySettingsPort()
    const now = Date.parse('2026-09-12T00:00:00Z')
    const budget = new BudgetManager(store, 10, 3, () => now)

    // Background limit is 10 - 3 = 7.
    for (let i = 0; i < 7; i++) {
      expect(budget.reserve('background').ok).toBe(true)
    }
    const exhausted = budget.reserve('background')
    expect(exhausted.ok).toBe(false)
    if (!exhausted.ok) {
      expect(exhausted.lane).toBe('background')
      expect(exhausted.resetAt).toBe(Date.UTC(2026, 8, 13, 0, 0, 0, 0))
    }

    // The interactive lane can still spend the remaining 3 (up to the full cap of 10).
    for (let i = 0; i < 3; i++) {
      expect(budget.reserve('interactive').ok).toBe(true)
    }
    expect(budget.reserve('interactive').ok).toBe(false)
  })

  it('rolls the counter over at UTC midnight', () => {
    const store = createInMemorySettingsPort()
    let now = Date.parse('2026-09-12T23:59:59.500Z')
    const budget = new BudgetManager(store, 2, 0, () => now)

    expect(budget.reserve('interactive').ok).toBe(true)
    expect(budget.reserve('interactive').ok).toBe(true)
    expect(budget.reserve('interactive').ok).toBe(false) // cap hit for the day

    now += 1000 // cross into 2026-09-13T00:00:00.5Z
    const afterMidnight = budget.reserve('interactive')
    expect(afterMidnight.ok).toBe(true) // fresh day, counter reset
  })

  it('status() reports usage without mutating the counter', () => {
    const store = createInMemorySettingsPort()
    const budget = new BudgetManager(store, 900, 100, () => Date.parse('2026-09-12T12:00:00Z'))
    budget.reserve('background')
    budget.reserve('background')

    const status1 = budget.status()
    const status2 = budget.status()
    expect(status1.usedToday).toBe(2)
    expect(status2.usedToday).toBe(2)
    expect(status1.dailyCap).toBe(900)
    expect(status1.backgroundLimit).toBe(800)
  })

  it('rejects a construction where interactiveReserve is not less than dailyCap', () => {
    const store = createInMemorySettingsPort()
    expect(() => new BudgetManager(store, 100, 100)).toThrow()
    expect(() => new BudgetManager(store, 100, 150)).toThrow()
  })
})

describe('BudgetManager (real SQLite — persists across a simulated restart)', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('survives closing and reopening the database connection entirely', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sieve-budget-test-'))
    const dbPath = path.join(dir, 'sieve.db')
    const fixedNow = () => Date.parse('2026-09-12T10:00:00Z')

    // "Process 1": open the DB, create the real settings table, spend some of today's budget.
    const db1 = new Database(dbPath)
    db1.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const budget1 = new BudgetManager(createSqliteSettingsPort(db1), 900, 100, fixedNow)
    budget1.reserve('background')
    budget1.reserve('background')
    budget1.reserve('background')
    expect(budget1.status().usedToday).toBe(3)
    db1.close() // simulates the process exiting

    // "Process 2": a brand new connection object, a brand new BudgetManager — nothing in JS
    // memory survived. Only the on-disk file did.
    const db2 = new Database(dbPath)
    const budget2 = new BudgetManager(createSqliteSettingsPort(db2), 900, 100, fixedNow)
    expect(budget2.status().usedToday).toBe(3)

    const next = budget2.reserve('background')
    expect(next).toEqual({ ok: true, lane: 'background', remaining: 796 })
    db2.close()
  })
})

import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { createInMemorySettingsPort, createSqliteSettingsPort } from '@/lib/ai/settings-store'

describe('createInMemorySettingsPort', () => {
  it('round-trips get/set and seeds initial values', () => {
    const store = createInMemorySettingsPort({ embedding_model: 'bge-small-en-v1.5' })
    expect(store.get('embedding_model')).toBe('bge-small-en-v1.5')
    expect(store.get('missing')).toBeUndefined()
    store.set('missing', 'now-set')
    expect(store.get('missing')).toBe('now-set')
  })
})

describe('createSqliteSettingsPort (real SQLite)', () => {
  function openTestDb(): Database.Database {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    return db
  }

  it('returns undefined for a key that was never set', () => {
    const store = createSqliteSettingsPort(openTestDb())
    expect(store.get('nope')).toBeUndefined()
  })

  it('writes and reads a value back', () => {
    const store = createSqliteSettingsPort(openTestDb())
    store.set('llm_requests_used_today', '5')
    expect(store.get('llm_requests_used_today')).toBe('5')
  })

  it('upserts on a second write to the same key (ON CONFLICT DO UPDATE)', () => {
    const db = openTestDb()
    const store = createSqliteSettingsPort(db)
    store.set('quota_reset_utc', '111')
    store.set('quota_reset_utc', '222')

    expect(store.get('quota_reset_utc')).toBe('222')
    const rowCount = (db.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number }).n
    expect(rowCount).toBe(1) // upsert, not a second row
  })
})

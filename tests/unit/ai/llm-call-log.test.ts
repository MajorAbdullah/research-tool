import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { createInMemoryLlmCallLog, createSqliteLlmCallLog } from '@/lib/ai/llm-call-log'

describe('createInMemoryLlmCallLog', () => {
  it('captures recorded entries for assertions', () => {
    const log = createInMemoryLlmCallLog()
    log.record({
      modelRequested: 'nvidia/nemotron-3-super-120b-a12b:free',
      modelResolved: 'nvidia/nemotron-3-super-120b-a12b:free',
      promptVersion: 'v1',
      promptTokens: 120,
      completionTokens: 66,
    })
    expect(log.entries).toHaveLength(1)
    expect(log.entries[0]?.modelResolved).toBe('nvidia/nemotron-3-super-120b-a12b:free')
  })
})

describe('createSqliteLlmCallLog (real SQLite)', () => {
  function openTestDb(): Database.Database {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE llm_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_requested TEXT NOT NULL,
        model_resolved TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsec') * 1000 as integer))
      )
    `)
    return db
  }

  it('writes a row with model_requested distinct from model_resolved', () => {
    const db = openTestDb()
    const log = createSqliteLlmCallLog(db)

    // A ':free' alias moving mid-flight — exactly the scenario P3.1.9 exists to keep visible.
    log.record({
      modelRequested: 'nvidia/nemotron-3-super-120b-a12b:free',
      modelResolved: 'nvidia/nemotron-3-super-120b-a12b-2026-09-01:free',
      promptVersion: 'v1',
      promptTokens: 500,
      completionTokens: 80,
    })

    const row = db.prepare('SELECT * FROM llm_calls').get() as Record<string, unknown>
    expect(row.model_requested).toBe('nvidia/nemotron-3-super-120b-a12b:free')
    expect(row.model_resolved).toBe('nvidia/nemotron-3-super-120b-a12b-2026-09-01:free')
    expect(row.model_requested).not.toBe(row.model_resolved)
    expect(row.prompt_version).toBe('v1')
    expect(row.prompt_tokens).toBe(500)
    expect(row.completion_tokens).toBe(80)
  })
})

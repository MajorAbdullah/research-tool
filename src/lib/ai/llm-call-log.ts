/**
 * Persistence seam for `llm_calls` (schema frozen in `src/db/schema.ts`). Same rationale as
 * `settings-store.ts`: a structural port instead of importing P1's not-yet-existing DB client.
 *
 * `modelResolved` is logged on every row, distinct from `modelRequested`, because `:free` aliases
 * move — OpenRouter can silently substitute a different backing model for the same slug. Without
 * recording what actually served the request, a provider-side swap looks like a mystery quality
 * regression instead of a visible, diffable fact in the log (CLAUDE.md, P3.1.9).
 */

import type { PreparedStatementLike, SqliteLike } from './settings-store'

export interface LlmCallRecord {
  modelRequested: string
  modelResolved: string
  promptVersion: string
  promptTokens: number
  completionTokens: number
}

export interface LlmCallLog {
  record(entry: LlmCallRecord): void
}

export function createSqliteLlmCallLog(db: SqliteLike): LlmCallLog {
  const insertStmt: PreparedStatementLike = db.prepare(
    'INSERT INTO llm_calls ' +
      '(model_requested, model_resolved, prompt_version, prompt_tokens, completion_tokens) ' +
      'VALUES (?, ?, ?, ?, ?)',
  )
  return {
    record(entry: LlmCallRecord): void {
      insertStmt.run(
        entry.modelRequested,
        entry.modelResolved,
        entry.promptVersion,
        entry.promptTokens,
        entry.completionTokens,
      )
    },
  }
}

/** In-memory log for tests — captures rows for assertions instead of touching real SQLite. */
export function createInMemoryLlmCallLog(): LlmCallLog & { entries: LlmCallRecord[] } {
  const entries: LlmCallRecord[] = []
  return {
    entries,
    record(entry: LlmCallRecord): void {
      entries.push(entry)
    },
  }
}

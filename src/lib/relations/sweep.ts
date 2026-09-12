/**
 * The full batched-labeling sweep (P9.2.2): collect up to `maxPairs` pending pairs, label them in
 * exactly ONE LLM request, store whatever the model was confident about.
 *
 * Intended to be called by P7's worker (as the `relate` job stage, or on its own schedule/
 * threshold) — this module only exports the *behavior*; wiring *when* it runs, and which
 * `LLMProvider` instance (chain/lane) to pass in, is out of this phase's scope (`src/worker/**`).
 * The free-tier budget table (CLAUDE.md) characterizes relation labeling as a background, batched
 * task alongside enrichment — callers most likely want the same `background`-lane provider
 * `createEnrichmentProvider()` builds, but that choice is deliberately left to the caller rather
 * than constructed in here.
 */

import type Database from 'better-sqlite3'
import type { LLMProvider, UtcMillis } from '@/types/contracts'
import { collectPendingPairs, type CollectPendingPairsOptions } from './pending-pairs'
import { labelPendingPairs } from './labeling'
import { storeLabeledRelations } from './store'

export type RelationSweepOutcome =
  | { ok: true; pairsConsidered: number; inserted: number; skipped: number; llmRequests: number }
  | { ok: false; reason: 'no_pending_pairs' }
  | { ok: false; reason: 'budget_exhausted'; resetAt: UtcMillis }
  | { ok: false; reason: 'model_unavailable'; detail: string }

export type RunRelationSweepOptions = CollectPendingPairsOptions

export async function runRelationSweep(
  sqlite: Database.Database,
  provider: LLMProvider,
  options: RunRelationSweepOptions,
): Promise<RelationSweepOutcome> {
  const pairs = collectPendingPairs(sqlite, options)
  if (pairs.length === 0) return { ok: false, reason: 'no_pending_pairs' }

  const outcome = await labelPendingPairs(sqlite, pairs, provider)
  if (!outcome.ok) return outcome

  const { inserted, skipped } = storeLabeledRelations(sqlite, outcome.labeled)
  return { ok: true, pairsConsidered: pairs.length, inserted, skipped, llmRequests: 1 }
}

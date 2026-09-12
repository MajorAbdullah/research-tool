/**
 * Labels up to 20 pending pairs (P9.2.2) in exactly ONE structured LLM request — the entire
 * reason this exists rather than looping `provider.structured()` once per pair, which would spend
 * one request per pair against the same account-wide 1,000/day free-tier ceiling enrichment and
 * chat also draw from (CLAUDE.md's "Free-Tier Budget": relation labeling is budgeted at ~0.05
 * requests/item, which is only true if this stays batched).
 *
 * Follows the exact same prompt-injection defence as enrichment (`@/lib/ai/enrichment.ts`): every
 * item's title/summary is untrusted content someone else wrote, wrapped in
 * `<untrusted_content>` before it ever reaches the model (CLAUDE.md, "Prompt Injection" — "an
 * item already in your own library is still untrusted input").
 */

import type Database from 'better-sqlite3'
import type { LLMMessage, LLMProvider, RelationType, UtcMillis } from '@/types/contracts'
import {
  loadPrompt,
  wrapUntrustedContent,
  BudgetExhaustedError,
  ChainExhaustedError,
  SchemaValidationError,
} from '@/lib/ai'
import { relationLabelSetSchema } from './labeling-schema'
import type { PendingPair } from './pending-pairs'

export interface LabeledPair {
  itemA: number
  itemB: number
  type: RelationType
  rationale: string
  distance: number
}

interface ItemContextRow {
  id: number
  title: string | null
  blurb: string | null
}

function loadItemContext(
  sqlite: Database.Database,
  itemIds: readonly number[],
): Map<number, ItemContextRow> {
  if (itemIds.length === 0) return new Map()
  const placeholders = itemIds.map(() => '?').join(',')
  const rows = sqlite
    .prepare(
      `SELECT id, title, summary_tldr AS blurb FROM items WHERE id IN (${placeholders})`,
    )
    .all(...itemIds) as ItemContextRow[]
  return new Map(rows.map((row) => [row.id, row]))
}

function describeItem(context: ItemContextRow | undefined, itemId: number): string {
  if (!context) return `(item ${itemId} is no longer available)`
  const title = context.title ?? '(untitled)'
  const blurb = context.blurb ?? '(no summary yet)'
  return `Title: ${title}\nSummary: ${blurb}`
}

function buildUserMessage(sqlite: Database.Database, pairs: readonly PendingPair[]): string {
  const itemIds = Array.from(new Set(pairs.flatMap((pair) => [pair.itemA, pair.itemB])))
  const contexts = loadItemContext(sqlite, itemIds)

  const pairBlocks = pairs.map((pair, index) => {
    const a = wrapUntrustedContent(describeItem(contexts.get(pair.itemA), pair.itemA))
    const b = wrapUntrustedContent(describeItem(contexts.get(pair.itemB), pair.itemB))
    return `### Pair ${index}\nItem A:\n${a}\nItem B:\n${b}`
  })

  return pairBlocks.join('\n\n')
}

export type LabelingOutcome =
  | { ok: true; labeled: LabeledPair[]; modelResolved: string }
  | { ok: false; reason: 'budget_exhausted'; resetAt: UtcMillis }
  | { ok: false; reason: 'model_unavailable'; detail: string }
  | { ok: false; reason: 'no_pending_pairs' }

export async function labelPendingPairs(
  sqlite: Database.Database,
  pairs: readonly PendingPair[],
  provider: LLMProvider,
): Promise<LabelingOutcome> {
  if (pairs.length === 0) return { ok: false, reason: 'no_pending_pairs' }

  const system = loadPrompt('relation-labeling.v1.md')
  const messages: LLMMessage[] = [
    { role: 'system', content: system.content },
    { role: 'user', content: buildUserMessage(sqlite, pairs) },
  ]

  let result
  try {
    // Exactly one call, regardless of `pairs.length` (bounded to <= 20 by the caller) — this is
    // the ~0.05 requests/item property, and it's what tests/unit/relations/labeling.test.ts
    // asserts a call-count spy on.
    result = await provider.structured(messages, relationLabelSetSchema)
  } catch (err) {
    if (err instanceof BudgetExhaustedError) {
      return { ok: false, reason: 'budget_exhausted', resetAt: err.resetAt }
    }
    if (err instanceof ChainExhaustedError || err instanceof SchemaValidationError) {
      return { ok: false, reason: 'model_unavailable', detail: err.message }
    }
    throw err
  }

  const labeled: LabeledPair[] = []
  for (const label of result.data.labels) {
    const pair = pairs[label.pairIndex]
    // Defensive against an out-of-range index the schema can't itself rule out (it only
    // constrains `pairIndex` to be a non-negative integer, not "a valid index into THIS
    // request's pairs") — dropped silently rather than thrown, matching "a model failure
    // degrades the item, never crashes the request" (CLAUDE.md).
    if (!pair) continue
    labeled.push({
      itemA: pair.itemA,
      itemB: pair.itemB,
      type: label.type,
      rationale: label.rationale,
      distance: pair.distance,
    })
  }

  return { ok: true, labeled, modelResolved: result.modelResolved }
}

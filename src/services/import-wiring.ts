/**
 * Real port implementations for `WhatsAppImportService`.
 *
 * P12 deliberately built the service as pure orchestration over three ports, shipping only
 * Map-backed reference implementations, because `src/db/**` and `src/app/**` were outside its
 * scope. Its `TODO(P0-reconcile)` asks that the real enqueuer "forwards to whatever P7/P8
 * exposes for create-an-item-from-a-URL — the same path capture uses". This file does that:
 * it reuses P7's `findItemByUrlHash` / `insertItem` / `touchItemUpdatedAt` and the shared job
 * queue rather than hand-writing SQL alongside them.
 *
 * The progress store persists into the existing `settings` key/value table instead of a new
 * `imports` table. A backlog import runs for roughly a day against the free-tier ceiling
 * (ADR 0004), so it MUST survive a container restart — P12's own docstring names that as the
 * property the real implementation has to supply. A migration for one low-volume record type
 * isn't worth it when `settings` already exists and already holds the daily quota counter.
 */
import { randomUUID } from 'node:crypto'

import { getDb, getSqlite } from '@/db/client'
import { createSqliteSettingsPort } from '@/lib/ai/settings-store'
import { getJobQueue } from '@/lib/queue'
import { findItemByUrlHash, insertItem, touchItemUpdatedAt } from '@/repositories/items'
import type {
  BackgroundBudgetStatus,
  BudgetSource,
  EnqueueResult,
  ImportLinkCandidate,
  ImportProgressStore,
  ImportRecordData,
  LinkEnqueuer,
} from '@/lib/importers'
import type { ItemKind } from '@/types/contracts'

const SETTINGS_PREFIX = 'import:'

/** `settings`-backed, so an in-flight import survives a restart. */
export function createSqliteImportProgressStore(): ImportProgressStore {
  const settings = createSqliteSettingsPort(getSqlite())
  const key = (id: string) => `${SETTINGS_PREFIX}${id}`

  return {
    async create(record: ImportRecordData) {
      settings.set(key(record.id), JSON.stringify(record))
    },
    async get(id: string) {
      const raw = settings.get(key(id))
      return raw ? (JSON.parse(raw) as ImportRecordData) : null
    },
    async update(id: string, patch: Partial<ImportRecordData>) {
      const raw = settings.get(key(id))
      if (!raw) return
      settings.set(key(id), JSON.stringify({ ...(JSON.parse(raw) as ImportRecordData), ...patch }))
    },
  }
}

/**
 * Reports how much of the day's BACKGROUND budget is left — never the interactive reserve.
 * A backlog import must not be able to starve the user's own chat queries, which is the
 * entire reason `LLM_INTERACTIVE_RESERVE` exists (ADR 0004).
 */
export function createBudgetSource(deps: {
  usedToday: () => number
  dailyCap: number
  interactiveReserve: number
  resetsAt: () => number
}): BudgetSource {
  return {
    async getBackgroundBudget(): Promise<BackgroundBudgetStatus> {
      const background = Math.max(0, deps.dailyCap - deps.interactiveReserve)
      return {
        remainingBackground: Math.max(0, background - deps.usedToday()),
        resetsAt: deps.resetsAt(),
      }
    },
  }
}

/** `ImportLinkKind` is a subset of `ItemKind` minus 'audio'; both share these names. */
function toItemKind(kind: ImportLinkCandidate['kind']): ItemKind {
  return kind as ItemKind
}

/**
 * Creates the item and enqueues the pipeline, via the same repository functions the capture
 * path uses.
 *
 * Note `createdAt`: the candidate's ORIGINAL WhatsApp message timestamp is preserved rather
 * than stamping now(). Reconstructing when a link was actually saved is the entire point of
 * importing a backlog — an import that dated everything "today" would destroy the history it
 * exists to recover.
 */
export function createLinkEnqueuer(userId: number): LinkEnqueuer {
  const db = getDb()
  const sqlite = getSqlite()
  const queue = getJobQueue()

  return {
    async enqueue(candidate: ImportLinkCandidate): Promise<EnqueueResult> {
      const existing = findItemByUrlHash(db, userId, candidate.urlHash)
      if (existing) {
        touchItemUpdatedAt(db, existing.id)
        return { itemId: `itm_${existing.id}`, duplicate: true }
      }

      const created = insertItem(db, {
        userId,
        url: candidate.url,
        canonicalUrl: candidate.url,
        urlHash: candidate.urlHash,
        kind: toItemKind(candidate.kind),
        sourceSurface: 'import',
        note: candidate.note,
      })

      // Backdate to the original share date. insertItem stamps now(), which is correct for
      // live capture and wrong for an import.
      sqlite
        .prepare('update items set created_at = ? where id = ?')
        .run(candidate.createdAt, created.id)

      queue.enqueue({ name: 'extract', itemId: created.id })
      return { itemId: `itm_${created.id}`, duplicate: false }
    },
  }
}

export function generateImportId(): string {
  return `imp_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

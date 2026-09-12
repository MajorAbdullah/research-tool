import { randomUUID } from 'node:crypto'
import { buildCandidates, countByKind, dedupeCandidates } from './candidates'
import { parseWhatsAppChat } from './chat-parser'
import { estimateEtaMs, formatDurationHuman } from './eta'
import { extractChatText } from './source'
import type { UrlCanonicalizer } from './url-hash'
import {
  ImportNotFoundError,
  InvalidImportTransitionError,
  type BudgetSource,
  type Clock,
  type ImportAction,
  type ImportProgressStore,
  type ImportRecordData,
  type ImportState,
  type ImportStatusView,
  type LinkEnqueuer,
} from './types'

const SYSTEM_CLOCK: Clock = { now: () => Date.now() }

function defaultIdGenerator(): string {
  return `imp_${randomUUID().replace(/-/g, '')}`
}

function utcDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function nextUtcMidnight(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}

const VALID_TRANSITIONS: Record<ImportAction, ReadonlySet<ImportState>> = {
  commit: new Set<ImportState>(['previewed']),
  pause: new Set<ImportState>(['running']),
  resume: new Set<ImportState>(['paused']),
  cancel: new Set<ImportState>(['previewed', 'running', 'paused']),
}

export interface WhatsAppImportServiceOptions {
  progressStore: ImportProgressStore
  budgetSource: BudgetSource
  linkEnqueuer: LinkEnqueuer
  /**
   * Background portion of the daily LLM cap (`LLM_DAILY_CAP - LLM_INTERACTIVE_RESERVE`,
   * see `.env.example` and ADR 0004 — 800 by default in this app, but that constant is
   * env-owned, not this module's to hardcode). Required, not defaulted, on purpose.
   */
  dailyBackgroundBudget: number
  /** ADR 0004's ~1.05 requests/item. Overridable for tests; stable enough to default. */
  requestsPerItem?: number
  /** Safety cap on how many candidates one `runBackfillTick` call releases at once. */
  maxBatchPerTick?: number
  clock?: Clock
  generateId?: () => string
  /** Overrides the built-in local canonicalizer used for `url_hash` (see url-hash.ts). */
  canonicalizeUrl?: UrlCanonicalizer
}

export interface IngestUploadInput {
  fileBuffer: Buffer
  filename: string
  mode?: 'dry_run' | 'commit'
  /** `url_hash`es already present in the library, for cross-import dedupe (P12.4). */
  existingUrlHashes?: ReadonlySet<string>
}

export type BackfillTickOutcome =
  'not_running' | 'completed' | 'progressed' | 'waiting_for_budget' | 'daily_cap_reached'

export interface BackfillTickResult {
  outcome: BackfillTickOutcome
  enqueued: number
  /** When `outcome` is a budget-waiting state: epoch-ms this import can next release links. */
  resumesAt?: number
}

/**
 * Parses WhatsApp backlog exports and drives a resumable, rate-aware backfill queue
 * against them (P12.5-12.7). Pure orchestration over the ports in `types.ts` — no DB,
 * no HTTP, no LLM calls happen in this file; the route layer (outside this phase's
 * scope) constructs this class with real, DB/AI-backed port implementations and calls
 * into it, per docs/API.md §3.9/§3.10.
 */
export class WhatsAppImportService {
  private readonly store: ImportProgressStore
  private readonly budgetSource: BudgetSource
  private readonly linkEnqueuer: LinkEnqueuer
  private readonly dailyBackgroundBudget: number
  private readonly requestsPerItem: number
  private readonly maxBatchPerTick: number
  private readonly clock: Clock
  private readonly generateId: () => string
  private readonly canonicalizeUrl: UrlCanonicalizer | undefined

  constructor(options: WhatsAppImportServiceOptions) {
    this.store = options.progressStore
    this.budgetSource = options.budgetSource
    this.linkEnqueuer = options.linkEnqueuer
    this.dailyBackgroundBudget = options.dailyBackgroundBudget
    this.requestsPerItem = options.requestsPerItem ?? 1.05
    this.maxBatchPerTick = options.maxBatchPerTick ?? 20
    this.clock = options.clock ?? SYSTEM_CLOCK
    this.generateId = options.generateId ?? defaultIdGenerator
    this.canonicalizeUrl = options.canonicalizeUrl
  }

  /**
   * `POST /api/v1/import`'s multipart upload path (docs/API.md §3.9.1): parses and
   * ALWAYS persists an import record, regardless of `mode` — a later `commit` doesn't
   * need to re-upload. Nothing is written to `items` here either way; `mode: "commit"`
   * only flips the new record straight to `running` so the next backfill tick starts
   * releasing links.
   */
  async ingestUpload(input: IngestUploadInput): Promise<ImportStatusView> {
    const text = extractChatText(input.fileBuffer)
    const parsed = parseWhatsAppChat(text)
    const allCandidates = buildCandidates(parsed, this.canonicalizeUrl)
    const { unique, duplicateCount } = dedupeCandidates(allCandidates, input.existingUrlHashes)

    const now = this.clock.now()
    const record: ImportRecordData = {
      id: this.generateId(),
      sourceFilename: input.filename,
      state: input.mode === 'commit' ? 'running' : 'previewed',
      totalLinks: allCandidates.length,
      duplicateCount,
      byKind: countByKind(unique),
      candidates: unique,
      nextCandidateIndex: 0,
      releasedOn: null,
      releasedCountForDay: 0,
      done: 0,
      failed: 0,
      error: null,
      sourceFormat: parsed.sourceFormat,
      dateFormat: parsed.dateFormat,
      createdAt: now,
      updatedAt: now,
    }
    await this.store.create(record)
    return this.toStatusView(record)
  }

  /**
   * `POST /api/v1/import`'s JSON control path (docs/API.md §3.9.2) — `commit` / `pause`
   * / `resume` / `cancel` against an existing import. Transitions are validated against
   * the same table the HTTP contract documents; an illegal one throws
   * {@link InvalidImportTransitionError} for the route layer to map to `409 CONFLICT`.
   */
  async applyAction(importId: string, action: ImportAction): Promise<ImportStatusView> {
    const record = await this.requireRecord(importId)
    if (!VALID_TRANSITIONS[action].has(record.state)) {
      throw new InvalidImportTransitionError(action, record.state)
    }
    const nextState: ImportState =
      action === 'pause' ? 'paused' : action === 'cancel' ? 'failed' : 'running'
    const patch: Partial<ImportRecordData> = { state: nextState, updatedAt: this.clock.now() }
    if (action === 'cancel') patch.error = 'cancelled by user'
    await this.store.update(importId, patch)
    return this.toStatusView({ ...record, ...patch })
  }

  /** `GET /api/v1/import/:id` (docs/API.md §3.10). */
  async getStatus(importId: string): Promise<ImportStatusView> {
    return this.toStatusView(await this.requireRecord(importId))
  }

  /**
   * The throttled backfill's unit of work (P12.5/P12.6): releases as many candidates
   * as today's remaining background LLM budget allows, then stops. A `running` import
   * that's merely waiting on budget is NOT paused and NOT failed, so the very next
   * tick after the UTC-midnight reset — whenever some external scheduler next calls
   * this (a worker poll loop, a cron; P12 does not own that scheduler) — picks up
   * right where it left off with zero manual intervention. All progress lives in
   * `this.store`, so a process restart between two ticks loses nothing.
   *
   * Throttling combines two signals, both bounded by `maxBatchPerTick` per call:
   *  - a per-import self-tracked daily counter (`releasedCountForDay`), which resets
   *    the moment a tick lands on a new UTC date — this is what "auto-resume after
   *    the reset" actually reduces to, with no special-cased resume logic needed;
   *  - the externally-reported `budgetSource.getBackgroundBudget()`, a live upper
   *    bound that also accounts for budget spent by non-import activity.
   */
  async runBackfillTick(importId: string): Promise<BackfillTickResult> {
    const record = await this.requireRecord(importId)
    if (record.state !== 'running') {
      return { outcome: 'not_running', enqueued: 0 }
    }

    const remainingCandidates = record.candidates.length - record.nextCandidateIndex
    if (remainingCandidates <= 0) {
      await this.store.update(importId, { state: 'completed', updatedAt: this.clock.now() })
      return { outcome: 'completed', enqueued: 0 }
    }

    const now = this.clock.now()
    const today = utcDateString(now)
    const releasedCountForDay = record.releasedOn === today ? record.releasedCountForDay : 0
    const selfCapRemaining = Math.max(0, this.dailyBackgroundBudget - releasedCountForDay)
    if (selfCapRemaining <= 0) {
      return { outcome: 'daily_cap_reached', enqueued: 0, resumesAt: nextUtcMidnight(now) }
    }

    const externalBudget = await this.budgetSource.getBackgroundBudget()
    if (externalBudget.remainingBackground <= 0) {
      return { outcome: 'waiting_for_budget', enqueued: 0, resumesAt: externalBudget.resetsAt }
    }

    const batchSize = Math.min(
      remainingCandidates,
      selfCapRemaining,
      externalBudget.remainingBackground,
      this.maxBatchPerTick,
    )
    if (batchSize <= 0) {
      return { outcome: 'waiting_for_budget', enqueued: 0, resumesAt: externalBudget.resetsAt }
    }

    let enqueued = 0
    for (let i = 0; i < batchSize; i++) {
      const candidate = record.candidates[record.nextCandidateIndex + i]
      if (!candidate) break
      await this.linkEnqueuer.enqueue(candidate)
      enqueued++
    }

    const newIndex = record.nextCandidateIndex + enqueued
    const isComplete = newIndex >= record.candidates.length
    await this.store.update(importId, {
      nextCandidateIndex: newIndex,
      releasedOn: today,
      releasedCountForDay: releasedCountForDay + enqueued,
      updatedAt: now,
      ...(isComplete ? { state: 'completed' as const } : {}),
    })
    return { outcome: isComplete ? 'completed' : 'progressed', enqueued }
  }

  private async requireRecord(importId: string): Promise<ImportRecordData> {
    const record = await this.store.get(importId)
    if (!record) throw new ImportNotFoundError(importId)
    return record
  }

  private async toStatusView(record: ImportRecordData): Promise<ImportStatusView> {
    const queued = Math.max(
      0,
      record.totalLinks - record.duplicateCount - record.done - record.failed,
    )
    let etaMs: number | null = null
    if (queued > 0 && record.state !== 'completed' && record.state !== 'failed') {
      const budget = await this.budgetSource.getBackgroundBudget()
      etaMs = estimateEtaMs({
        remainingItems: queued,
        now: this.clock.now(),
        remainingBudgetToday: budget.remainingBackground,
        dailyBackgroundBudget: this.dailyBackgroundBudget,
        resetsAt: budget.resetsAt,
        requestsPerItem: this.requestsPerItem,
      })
    }
    return {
      id: record.id,
      state: record.state,
      totalLinks: record.totalLinks,
      duplicateCount: record.duplicateCount,
      byKind: record.byKind,
      queued,
      done: record.done,
      failed: record.failed,
      etaMs,
      etaHuman: etaMs === null ? null : formatDurationHuman(etaMs),
      error: record.error,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }
}

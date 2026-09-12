/**
 * Local types for the WhatsApp backlog importer (P12).
 *
 * P12 owns ONLY `src/lib/importers/**` (see docs/plans/2026-09-12-sieve-implementation-plan.md
 * §9/§10). The shared HTTP contract types (e.g. the real `ItemKind`) live in
 * `src/types/contracts.ts`, owned by another agent, and the DB/AI layers this module
 * ultimately drives (`src/db/**`, `src/lib/ai/**`) are likewise out of scope here. Anything
 * below that mirrors a shape owned elsewhere is a deliberate, temporary local definition so
 * this module stays independently testable with no cross-phase file access — each such type
 * carries a `// TODO(P0-reconcile):` comment naming what it should eventually import instead.
 *
 * The "ports" section (Clock/BudgetSource/LinkEnqueuer/ImportProgressStore) is this module's
 * entire dependency surface on the rest of the app (CLAUDE.md's Dependency Inversion
 * principle): the route layer (not part of this phase) is expected to construct
 * `WhatsAppImportService` (see `./service.ts`) with real, DB/AI-backed implementations of
 * these interfaces. Nothing in this file or the rest of `src/lib/importers/**` imports from
 * `src/db/**`, `src/app/**`, or `src/lib/ai/**` directly.
 */

// TODO(P0-reconcile): should import `ItemKind` from `src/types/contracts.ts` and treat this as
// a subset of it. This importer only ever buckets into 6 kinds (no `audio`) to match
// docs/API.md §3.9.1's `by_kind` example exactly — the real per-item kind classification
// (P2.1.2) runs later, against the canonicalized URL, once an item actually exists. This type
// is only used for the dry-run preview / progress breakdown, never persisted as an item's kind.
export type ImportLinkKind = 'github' | 'video' | 'article' | 'social' | 'pdf' | 'other'

export const IMPORT_LINK_KINDS: readonly ImportLinkKind[] = [
  'github',
  'video',
  'article',
  'social',
  'pdf',
  'other',
]

/** Which physical timestamp style was found while parsing a `_chat.txt` export. */
export type WhatsAppSourceFormat = 'ios' | 'android' | 'mixed'

export type DateComponentOrder = 'DMY' | 'MDY'

export interface DateFormatInfo {
  order: DateComponentOrder
  /**
   * 'certain' — some line in the export had a first/second date component above 12,
   * which unambiguously fixes day/month order. 'assumed' — every line was ambiguous
   * (both components ≤ 12 everywhere), so DD/MM/YYYY was assumed (WhatsApp's own
   * international default) and this is surfaced rather than silently guessed.
   */
  confidence: 'certain' | 'assumed'
}

export interface ParsedWhatsAppMessage {
  /** 1-based line number of the message's header line in the source `_chat.txt`. */
  lineNumber: number
  /** UTC epoch-ms — the ORIGINAL WhatsApp send time, never the import time. */
  timestampMs: number
  /** `null` for a recognized system notification (encryption notice, join/leave, ...). */
  author: string | null
  /** Full message text, continuation lines joined with `\n`. */
  text: string
  isSystem: boolean
}

export interface SkippedLine {
  /** 1-based line number in the source file. */
  lineNumber: number
  /** The original (pre-normalization) line content, so the reason is verifiable. */
  raw: string
  reason: string
}

export interface ChatParseResult {
  messages: ParsedWhatsAppMessage[]
  skipped: SkippedLine[]
  sourceFormat: WhatsAppSourceFormat
  dateFormat: DateFormatInfo
}

export interface ImportLinkCandidate {
  url: string
  urlHash: string
  kind: ImportLinkKind
  /** Original WhatsApp message timestamp (UTC epoch-ms) — see docs/API.md §3.10. */
  createdAt: number
  /** The full message the URL was found in — becomes the item's note. */
  note: string
  author: string | null
  sourceLineNumber: number
}

// TODO(P0-reconcile): mirrors the `state` enum implied by docs/API.md §3.9/§3.10
// (`previewed | running | paused | completed | failed`). Should become a single shared
// definition in `src/types/contracts.ts` once that file exists in this worktree.
export type ImportState = 'previewed' | 'running' | 'paused' | 'completed' | 'failed'

export type ImportAction = 'commit' | 'pause' | 'resume' | 'cancel'

/**
 * Everything needed to resume an import after a process restart, expressed as plain
 * data so any storage layer (SQLite row, JSON blob, in-memory map for tests) can hold it.
 */
export interface ImportRecordData {
  id: string
  sourceFilename: string
  state: ImportState
  /** Total link occurrences found, BEFORE dedupe. */
  totalLinks: number
  /** How many of `totalLinks` were dropped as duplicates (existing item or in-file repeat). */
  duplicateCount: number
  byKind: Record<ImportLinkKind, number>
  /** The deduped, queueable candidates, in the order they'll be released. */
  candidates: ImportLinkCandidate[]
  /** Resume cursor: `candidates[0..nextCandidateIndex)` have already been handed to the enqueuer. */
  nextCandidateIndex: number
  /** UTC `YYYY-MM-DD` this import last released candidates on, or `null` before the first release. */
  releasedOn: string | null
  /** How many candidates were released on `releasedOn` — resets when the UTC date rolls over. */
  releasedCountForDay: number
  /**
   * Pipeline-derived outcome counts. This module never computes these itself — they
   * reflect real item/job state (docs/API.md §3.10: "derived from real job/item state, not
   * in-memory counters"), which lives in `src/db/**`, outside P12's scope. The real
   * `ImportProgressStore` is expected to keep these current; this module only reads them.
   */
  done: number
  failed: number
  /** Set only when `state === 'failed'`; distinguishes a real failure from `cancel` (§3.9.2). */
  error: string | null
  sourceFormat: WhatsAppSourceFormat
  dateFormat: DateFormatInfo
  createdAt: number
  updatedAt: number
}

/** The shape `GET /api/v1/import/:id` (docs/API.md §3.10) needs, minus HTTP envelope concerns. */
export interface ImportStatusView {
  id: string
  state: ImportState
  totalLinks: number
  duplicateCount: number
  byKind: Record<ImportLinkKind, number>
  queued: number
  done: number
  failed: number
  etaMs: number | null
  /** Human-readable rendering of `etaMs` (e.g. "11h 30m"), or `null` when `etaMs` is. */
  etaHuman: string | null
  error: string | null
  createdAt: number
  updatedAt: number
}

export interface BackgroundBudgetStatus {
  /** Requests left today for non-interactive/background use (ADR 0004's 800 of 900). */
  remainingBackground: number
  /** UTC epoch-ms of the next daily reset. */
  resetsAt: number
}

// ---------------------------------------------------------------------------------------
// Ports — the module's only dependencies on the rest of the app. Implemented for real by
// the phases that own the DB/AI layers; here so this module stays unit-testable with plain
// fakes and zero DB, network, or LLM access (CLAUDE.md's Dependency Inversion principle).
// ---------------------------------------------------------------------------------------

export interface Clock {
  now(): number
}

// TODO(P0-reconcile): read-only view onto P3.1.5's budget manager (a persistent UTC-day
// counter in the `settings` table). Once that module exists, adapt it to this interface
// rather than importing it directly, so this module keeps zero DB/AI dependencies.
export interface BudgetSource {
  getBackgroundBudget(): Promise<BackgroundBudgetStatus>
}

export interface EnqueueResult {
  itemId: string
  duplicate: boolean
}

// TODO(P0-reconcile): the real implementation forwards to whatever P7/P8 exposes for
// "create an item from a URL" (the same path capture uses) — not something this module
// should call directly, since `src/db/**` and `src/app/**` are out of P12's scope.
export interface LinkEnqueuer {
  enqueue(candidate: ImportLinkCandidate): Promise<EnqueueResult>
}

/**
 * Persistence port for import records. The real implementation is DB-backed (outside
 * P12's scope); `./memory-store.ts` ships a Map-backed reference implementation used by
 * this module's own tests, which does NOT survive a process restart on purpose — that
 * property is exactly what the real implementation must supply.
 */
export interface ImportProgressStore {
  create(record: ImportRecordData): Promise<void>
  get(id: string): Promise<ImportRecordData | null>
  update(id: string, patch: Partial<ImportRecordData>): Promise<void>
}

export class ImportNotFoundError extends Error {
  constructor(public readonly importId: string) {
    super(`import not found: ${importId}`)
    this.name = 'ImportNotFoundError'
  }
}

export class InvalidImportTransitionError extends Error {
  constructor(
    public readonly action: ImportAction,
    public readonly fromState: ImportState,
  ) {
    super(`cannot apply action "${action}" to import in state "${fromState}"`)
    this.name = 'InvalidImportTransitionError'
  }
}

export class UnparseableExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnparseableExportError'
  }
}

/**
 * Shared types for the board feature (P11).
 *
 * `ItemKind`/`ItemStatus`/`ItemSummary`/`Topic` are re-exported from `@/components/common/types`
 * (the same source ItemCard/StatusPill/KindBadge/TopicChip already import from) rather than
 * redeclared a third time — that file's own comment explains why it mirrors
 * `src/types/contracts.ts` for now; this file follows the same convention so every board file has
 * one place to import item-shaped types from.
 */

import type { ItemKind, ItemStatus, ItemSummary, Topic } from '@/components/common/types'

export type { ItemKind, ItemStatus, ItemSummary, Topic }

/**
 * The six statuses a board card can actually be *in* (as opposed to pipeline-owned states it
 * passes through before a human ever sees it). Derived with `Exclude` rather than hand-listed so
 * it can never silently drift from `ItemStatus` if a status is ever added.
 */
export type DraggableStatus = Exclude<ItemStatus, 'queued' | 'processing' | 'failed'>

/**
 * Pipeline-owned statuses (docs/API.md §3.6): no outgoing transition exists for any of these
 * through `PATCH /api/v1/items/:id/status` — `queued`/`processing` are mid-flight, `failed`
 * recovers only via `POST /api/v1/items/:id/retry`. Never a drop target, never draggable; the
 * board surfaces them only as a read-only indicator (see pipeline-strip.tsx).
 */
export const PIPELINE_STATUSES: readonly ItemStatus[] = ['queued', 'processing', 'failed']

export function isPipelineStatus(status: ItemStatus): boolean {
  return PIPELINE_STATUSES.includes(status)
}

export function isDraggableStatus(status: ItemStatus): status is DraggableStatus {
  return !isPipelineStatus(status)
}

/** One visual board column. `archived_dropped` is the one column backed by two real statuses. */
export type BoardColumnKey = 'inbox' | 'to_test' | 'testing' | 'tested' | 'archived_dropped'

export interface BoardColumnConfig {
  key: BoardColumnKey
  label: string
  statuses: readonly DraggableStatus[]
  /**
   * The status a plain drop into this column resolves to. Only meaningful for
   * `archived_dropped`, which maps to two real statuses — a drag is a coarse gesture ("shelve
   * this"), so it defaults to the more common "keep for reference" outcome; a card's own status
   * `<select>` (always present, see board-card.tsx) and its "Drop instead" menu action give exact
   * control over the archived/dropped distinction without requiring drag precision for it.
   */
  defaultDropStatus: DraggableStatus
}

export const BOARD_COLUMNS: readonly BoardColumnConfig[] = [
  { key: 'inbox', label: 'Inbox', statuses: ['inbox'], defaultDropStatus: 'inbox' },
  { key: 'to_test', label: 'To Test', statuses: ['to_test'], defaultDropStatus: 'to_test' },
  { key: 'testing', label: 'Testing', statuses: ['testing'], defaultDropStatus: 'testing' },
  { key: 'tested', label: 'Tested', statuses: ['tested'], defaultDropStatus: 'tested' },
  {
    key: 'archived_dropped',
    label: 'Archived / Dropped',
    statuses: ['archived', 'dropped'],
    defaultDropStatus: 'archived',
  },
]

export function columnForStatus(status: ItemStatus): BoardColumnConfig | undefined {
  return BOARD_COLUMNS.find((column) => (column.statuses as readonly ItemStatus[]).includes(status))
}

export function columnByKey(key: BoardColumnKey): BoardColumnConfig {
  const column = BOARD_COLUMNS.find((c) => c.key === key)
  if (!column) throw new Error(`Unknown board column "${key}"`)
  return column
}

/** Display labels shared by the per-card status `<select>` (board-card.tsx) and the pipeline strip. */
export const STATUS_LABELS: Record<ItemStatus, string> = {
  queued: 'Queued',
  processing: 'Processing',
  inbox: 'Inbox',
  to_test: 'To Test',
  testing: 'Testing',
  tested: 'Tested',
  archived: 'Archived',
  dropped: 'Dropped',
  failed: 'Failed',
}

/** Every `ItemKind` value, for populating the kind filter — mirrors kind-badge.tsx's own labels. */
export const ALL_ITEM_KINDS: readonly ItemKind[] = [
  'github',
  'video',
  'article',
  'social',
  'pdf',
  'audio',
  'other',
]

export const KIND_LABELS: Record<ItemKind, string> = {
  github: 'Repo',
  video: 'Video',
  article: 'Article',
  social: 'Social',
  pdf: 'PDF',
  audio: 'Audio',
  other: 'Link',
}

export interface BoardFilters {
  kind: ItemKind | null
  topic: string | null // topic slug
}

export const EMPTY_FILTERS: BoardFilters = { kind: null, topic: null }

/** Outcome-note read state for a Tested card: `undefined` = not fetched yet, `null` = fetched and empty. */
export type OutcomeNoteState = string | null | undefined

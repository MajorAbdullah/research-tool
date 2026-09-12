/**
 * Business logic behind every `/api/v1/items/**` route this phase owns (docs/API.md §3.3–§3.7).
 * Routes parse/authorize/delegate; this is what they delegate to.
 */

import { and, asc, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { getSqlite } from '@/db/client'
import { items } from '@/db/schema'
import { scopedTo } from '@/repositories/scoping'
import { getJobQueue } from '@/lib/queue'
import { ItemStatus, JobName } from '@/types/contracts'
import type {
  ItemStatus as ItemStatusType,
  JobName as JobStage,
  JobPayload,
} from '@/types/contracts'
import { ApiError, buildPage, decodeCursor, type Cursor, type Page } from '@/services/http'
import { toItemId, fromItemId } from '@/services/ids'
import {
  hasAnyHint,
  mergeClientCaptureIntoRawPayload,
  pickHint,
  readStoredClientCapture,
} from '@/services/client-capture'
import { mapItem, mapItemSummary, type ItemRow } from '@/services/item-mapper'
import {
  clearManualTopicOverride,
  getPrimaryTopic,
  getPrimaryTopicsByItemIds,
  hasAnyTagCondition,
  primaryTopicSlugCondition,
  setManualTopicOverride,
} from '@/services/topics'
import { getTagsByItemIds, getTagsForItem, replaceItemTags } from '@/services/tags'
import type { ItemPatchBody, ItemsListQuery, SortMode } from '@/services/items-schema'
import type { ItemRelationWire, ItemSummaryWire, ItemWire } from '@/services/wire-types'

// ---------------------------------------------------------------------------
// Shared: resolve the opaque wire id to a row, scoped by user
// ---------------------------------------------------------------------------

/** `itm_...` -> the item row, scoped to `userId`. Throws `NOT_FOUND` for a bad id or another user's item — indistinguishable on purpose (docs/API.md §1.5). */
function requireOwnedItem(userId: number, wireId: string): ItemRow {
  const rowId = fromItemId(wireId)
  if (rowId === null) throw ApiError.notFound()
  const db = getDb()
  const row = db
    .select()
    .from(items)
    .where(scopedTo(items.userId, userId, eq(items.id, rowId)))
    .get()
  if (!row) throw ApiError.notFound()
  return row
}

interface RelationRow {
  other_id: number
  other_title: string | null
  other_kind: ItemRelationWire['kind']
  type: ItemRelationWire['type']
  rationale: string | null
  score: number
}

function getRelationsForItem(userId: number, itemId: number): ItemRelationWire[] {
  const rows = getSqlite()
    .prepare<[number, number, number, number], RelationRow>(
      `SELECT other.id AS other_id, other.title AS other_title, other.kind AS other_kind,
              r.type AS type, r.rationale AS rationale, r.score AS score
       FROM relations r
       JOIN items other ON other.id = (CASE WHEN r.item_a = ? THEN r.item_b ELSE r.item_a END)
       WHERE (r.item_a = ? OR r.item_b = ?) AND other.user_id = ?
       ORDER BY r.score DESC`,
    )
    .all(itemId, itemId, itemId, userId)

  return rows.map((row) => ({
    item_id: toItemId(row.other_id),
    title: row.other_title,
    kind: row.other_kind,
    type: row.type,
    rationale: row.rationale ?? '',
    score: row.score,
  }))
}

/** Assembles the full `Item` wire shape for one row — shared by detail/patch/status/retry responses. */
function toItemWire(userId: number, row: ItemRow): ItemWire {
  const db = getDb()
  const topic = getPrimaryTopic(db, row.id)
  const tagLabels = getTagsForItem(db, row.id)
  const relations = getRelationsForItem(userId, row.id)
  return mapItem(row, topic, tagLabels, relations)
}

// ---------------------------------------------------------------------------
// GET /api/v1/items (docs/API.md §3.3)
// ---------------------------------------------------------------------------

function buildFilterConditions(userId: number, query: ItemsListQuery): SQL {
  const conditions: Array<SQL | undefined> = []
  if (query.kind?.length) conditions.push(sql`${items.kind} IN ${query.kind}`)
  if (query.status?.length) conditions.push(sql`${items.status} IN ${query.status}`)
  if (query.extractionTier?.length)
    conditions.push(sql`${items.extractionTier} IN ${query.extractionTier}`)
  if (query.dateFrom !== undefined) conditions.push(gte(items.createdAt, query.dateFrom))
  if (query.dateTo !== undefined) conditions.push(lte(items.createdAt, query.dateTo))
  if (query.topic?.length) conditions.push(primaryTopicSlugCondition(query.topic))
  if (query.tag?.length) conditions.push(hasAnyTagCondition(query.tag))
  return scopedTo(items.userId, userId, ...conditions)
}

/** The value each `sort` mode orders by — always a plain number, so cursors are uniform across modes. */
function sortExpr(sort: SortMode) {
  if (sort === 'recently_opened') return sql<number>`coalesce(${items.lastOpenedAt}, -1)`
  if (sort === 'most_related') {
    return sql<number>`(SELECT COUNT(*) FROM relations WHERE relations.item_a = ${items.id} OR relations.item_b = ${items.id})`
  }
  return sql<number>`${items.createdAt}`
}

function sortDirection(sort: SortMode): 'asc' | 'desc' {
  return sort === 'oldest' ? 'asc' : 'desc'
}

/** `(expr, id) </> (cursor.v, cursor.id)` in keyset order — "give me rows strictly after this cursor." */
function keysetCondition(expr: SQL<number>, direction: 'asc' | 'desc', cursor: Cursor): SQL {
  const cmp = direction === 'desc' ? sql.raw('<') : sql.raw('>')
  return sql`((${expr} ${cmp} ${cursor.v}) OR (${expr} = ${cursor.v} AND ${items.id} ${cmp} ${cursor.id}))`
}

export function listItems(userId: number, query: ItemsListQuery): Page<ItemSummaryWire> {
  const db = getDb()
  const sqlite = getSqlite()

  let cursor: Cursor | null = null
  if (query.cursor) {
    cursor = decodeCursor(query.cursor)
    if (!cursor) {
      throw ApiError.validation('cursor is invalid.', { field: 'cursor', reason: 'malformed' })
    }
  }

  const direction = sortDirection(query.sort)
  const expr = sortExpr(query.sort)
  const filterCondition = buildFilterConditions(userId, query)
  const whereCondition = cursor
    ? and(filterCondition, keysetCondition(expr, direction, cursor))
    : filterCondition

  const rows = db
    .select({ item: items, sortValue: expr })
    .from(items)
    .where(whereCondition)
    .orderBy(
      direction === 'desc' ? desc(expr) : asc(expr),
      direction === 'desc' ? desc(items.id) : asc(items.id),
    )
    .limit(query.limit + 1)
    .all()

  const itemIds = rows.map((row) => row.item.id)
  const topicsByItem = getPrimaryTopicsByItemIds(sqlite, itemIds)
  const tagsByItem = getTagsByItemIds(sqlite, itemIds)

  return buildPage(
    rows,
    query.limit,
    (row) =>
      mapItemSummary(
        row.item,
        topicsByItem.get(row.item.id) ?? null,
        tagsByItem.get(row.item.id) ?? [],
      ),
    (row) => ({ v: row.sortValue, id: row.item.id }),
  )
}

// ---------------------------------------------------------------------------
// GET /api/v1/items/:id (docs/API.md §3.4)
// ---------------------------------------------------------------------------

export function getItemDetail(userId: number, wireId: string): ItemWire {
  const row = requireOwnedItem(userId, wireId)
  return toItemWire(userId, row)
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/items/:id (docs/API.md §3.5)
// ---------------------------------------------------------------------------

export function patchItem(userId: number, wireId: string, patch: ItemPatchBody): ItemWire {
  const db = getDb()
  return db.transaction((tx) => {
    const existing = requireOwnedItem(userId, wireId)

    const columnUpdates: Partial<typeof items.$inferInsert> = { updatedAt: Date.now() }
    if (patch.note !== undefined) columnUpdates.note = patch.note
    if (patch.outcome_note !== undefined) columnUpdates.outcomeNote = patch.outcome_note
    if (patch.starred !== undefined) columnUpdates.starred = patch.starred
    tx.update(items).set(columnUpdates).where(eq(items.id, existing.id)).run()

    if (patch.tags !== undefined) {
      replaceItemTags(tx, userId, existing.id, patch.tags)
    }

    if (patch.topic !== undefined) {
      if (patch.topic === null) {
        clearManualTopicOverride(tx, existing.id)
      } else {
        setManualTopicOverride(tx, userId, existing.id, patch.topic)
      }
    }

    return toItemWire(userId, requireOwnedItem(userId, wireId))
  })
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/items/:id/status (docs/API.md §3.6)
// ---------------------------------------------------------------------------

/**
 * The state machine, transcribed exactly from docs/API.md §3.6 — see that section for the prose
 * explanation. `queued`/`processing`/`failed` have no outgoing edges through this endpoint at
 * all (pipeline-owned; `failed` recovers via `POST .../retry` instead).
 */
export const STATUS_TRANSITIONS: Record<ItemStatusType, ItemStatusType[]> = {
  [ItemStatus.Queued]: [],
  [ItemStatus.Processing]: [],
  [ItemStatus.Inbox]: [
    ItemStatus.ToTest,
    ItemStatus.Testing,
    ItemStatus.Tested,
    ItemStatus.Archived,
    ItemStatus.Dropped,
  ],
  [ItemStatus.ToTest]: [
    ItemStatus.Inbox,
    ItemStatus.Testing,
    ItemStatus.Tested,
    ItemStatus.Archived,
    ItemStatus.Dropped,
  ],
  [ItemStatus.Testing]: [
    ItemStatus.Inbox,
    ItemStatus.ToTest,
    ItemStatus.Tested,
    ItemStatus.Archived,
    ItemStatus.Dropped,
  ],
  [ItemStatus.Tested]: [
    ItemStatus.Inbox,
    ItemStatus.ToTest,
    ItemStatus.Testing,
    ItemStatus.Archived,
    ItemStatus.Dropped,
  ],
  [ItemStatus.Archived]: [ItemStatus.Inbox],
  [ItemStatus.Dropped]: [ItemStatus.Inbox],
  [ItemStatus.Failed]: [],
}

export function patchItemStatus(userId: number, wireId: string, status: ItemStatusType): ItemWire {
  const db = getDb()
  return db.transaction((tx) => {
    const existing = requireOwnedItem(userId, wireId)
    const allowedNext = STATUS_TRANSITIONS[existing.status]

    if (!allowedNext.includes(status)) {
      throw ApiError.invalidStatusTransition(existing.status, status, allowedNext)
    }

    tx.update(items).set({ status, updatedAt: Date.now() }).where(eq(items.id, existing.id)).run()
    return toItemWire(userId, requireOwnedItem(userId, wireId))
  })
}

// ---------------------------------------------------------------------------
// POST /api/v1/items/:id/retry (docs/API.md §3.7)
// ---------------------------------------------------------------------------

export interface RetryInput {
  stage: JobStage
  html?: string
  transcript?: string
  caption?: string
}

export interface RetryResult {
  id: string
  status: ItemStatusType
  stage: JobStage
}

/**
 * `resolve` is nominally one of the six nominally-valid `JobStage` values (docs/API.md §3.7's
 * error table validates against exactly that six-value enum), but `ResolveJobPayload`
 * (src/types/contracts.ts, frozen/out of this phase's scope) has no `itemId` field — it's the
 * one stage that runs BEFORE an item exists (see `src/worker/loop.ts`'s `itemIdOf`). There is no
 * well-typed job this endpoint could enqueue for it against an item that already exists, so it's
 * rejected here rather than silently misconstructing a payload. See this phase's final report.
 */
function buildRetryPayload(
  stage: Exclude<JobStage, typeof JobName.Resolve>,
  itemId: number,
  rawPayload: unknown,
): JobPayload {
  switch (stage) {
    case JobName.Extract: {
      const hint = readStoredClientCapture(rawPayload)
      return hasAnyHint(hint)
        ? { name: JobName.Extract, itemId, hint }
        : { name: JobName.Extract, itemId }
    }
    case JobName.Enrich:
      return { name: JobName.Enrich, itemId }
    case JobName.Embed:
      return { name: JobName.Embed, itemId }
    case JobName.Relate:
      return { name: JobName.Relate, itemId }
    case JobName.Index:
      return { name: JobName.Index, itemId }
  }
}

export function retryItem(userId: number, wireId: string, input: RetryInput): RetryResult {
  if (input.stage === JobName.Resolve) {
    throw ApiError.validation('stage "resolve" cannot be retried on an existing item.', {
      field: 'stage',
      reason: 'resolve only runs before an item exists',
    })
  }
  // A plain local const (rather than repeated `input.stage` access) so the narrowing above
  // survives into the closure below — TS doesn't carry a property narrowing like `input.stage`
  // across a function boundary, but a never-reassigned local variable's narrowing does.
  const stage = input.stage

  const db = getDb()
  const sqlite = getSqlite()

  return db.transaction((tx) => {
    const existing = requireOwnedItem(userId, wireId)

    const conflict = sqlite
      .prepare<[string, number], { id: number }>(
        `SELECT id FROM jobs WHERE state IN ('queued','active') AND name = ? AND json_extract(payload, '$.itemId') = ?`,
      )
      .get(stage, existing.id)
    if (conflict) {
      throw ApiError.conflict('A job for this item at this stage is already pending or running.')
    }

    const freshHint = pickHint(input)
    let rawPayload = existing.rawPayload
    if (hasAnyHint(freshHint)) {
      rawPayload = mergeClientCaptureIntoRawPayload(existing.rawPayload, freshHint)
      tx.update(items).set({ rawPayload }).where(eq(items.id, existing.id)).run()
    }

    tx.update(items)
      .set({ status: ItemStatus.Queued, updatedAt: Date.now() })
      .where(eq(items.id, existing.id))
      .run()

    const payload = buildRetryPayload(stage, existing.id, rawPayload)
    getJobQueue().enqueue(payload)

    return { id: toItemId(existing.id), status: ItemStatus.Queued, stage }
  })
}

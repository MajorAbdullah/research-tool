/**
 * The composable filter set shared by every retrieval path (FTS5, vector, and therefore the RRF
 * fusion built from them) — docs/API.md §3.2's `kind`/`topic`/`tag`/`status`/`extraction_tier`/
 * `date_from`/`date_to`. All filters combine with AND; values within one filter combine with OR
 * (e.g. `kind=github,video` means "github or video") — this module is where that rule lives.
 *
 * Every fragment is parameterized — never a value interpolated into the SQL text — even though
 * every value reaching here has already passed Zod validation at the HTTP boundary
 * (`query-schema.ts`). Defense in depth costs nothing and CLAUDE.md's "parameterized SQL only" has
 * no carve-out for "but it was already validated."
 */

import type { ExtractionTier, ItemKind, ItemStatus } from '@/types/contracts'

export interface SearchFilters {
  kind?: readonly ItemKind[]
  /** Topic slugs. */
  topic?: readonly string[]
  /** Tag labels. */
  tag?: readonly string[]
  status?: readonly ItemStatus[]
  extractionTier?: readonly ExtractionTier[]
  /** Inclusive lower bound on `items.created_at` (epoch ms). */
  dateFrom?: number
  /** Inclusive upper bound on `items.created_at` (epoch ms). */
  dateTo?: number
}

export interface SqlFragment {
  /** Always starts with ` AND ` (leading space) when non-empty, so callers can splice it
   *  directly after their own mandatory `WHERE ... items.user_id = ?` clause. Empty string (never
   *  `undefined`) when there is nothing to filter on, so callers can always concatenate blindly. */
  sql: string
  params: unknown[]
}

function inClause(column: string, values: readonly string[]): SqlFragment {
  const placeholders = values.map(() => '?').join(',')
  return { sql: `${column} IN (${placeholders})`, params: [...values] }
}

/**
 * Builds the `AND ...` fragment every search query appends after its mandatory
 * `items.user_id = ?` predicate. Assumes the query's `FROM`/`JOIN` chain includes `items` (plain,
 * unaliased) — every caller in this module does.
 */
export function buildItemFilterFragment(filters: SearchFilters): SqlFragment {
  const clauses: string[] = []
  const params: unknown[] = []

  const pushIn = (column: string, values: readonly string[] | undefined): void => {
    if (!values || values.length === 0) return
    const fragment = inClause(column, values)
    clauses.push(fragment.sql)
    params.push(...fragment.params)
  }

  pushIn('items.kind', filters.kind)
  pushIn('items.status', filters.status)
  pushIn('items.extraction_tier', filters.extractionTier)

  if (filters.dateFrom !== undefined) {
    clauses.push('items.created_at >= ?')
    params.push(filters.dateFrom)
  }
  if (filters.dateTo !== undefined) {
    clauses.push('items.created_at <= ?')
    params.push(filters.dateTo)
  }

  if (filters.tag && filters.tag.length > 0) {
    const tagIn = inClause('t.label', filters.tag)
    clauses.push(
      `EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id ` +
        `WHERE it.item_id = items.id AND ${tagIn.sql})`,
    )
    params.push(...tagIn.params)
  }

  if (filters.topic && filters.topic.length > 0) {
    const topicIn = inClause('tp.slug', filters.topic)
    clauses.push(
      `EXISTS (SELECT 1 FROM item_topics itp JOIN topics tp ON tp.id = itp.topic_id ` +
        `WHERE itp.item_id = items.id AND ${topicIn.sql})`,
    )
    params.push(...topicIn.params)
  }

  return {
    sql: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '',
    params,
  }
}

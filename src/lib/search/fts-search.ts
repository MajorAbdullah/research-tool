/**
 * Keyword search over `items_fts` (the external-content FTS5 index over `items_fts_source`, see
 * drizzle/0000_init.sql's header), ranked by `bm25()`.
 *
 * `bm25()` is ascending-is-better in SQLite FTS5 — smaller (more negative) values are better
 * matches — so every query here orders `ASC`. Callers should treat the raw value as debugging
 * output only, never compare it across queries or against `vec0` distance directly (that's
 * exactly the incomparable-scales problem RRF fusion exists to route around — see `rrf.ts`).
 */

import type Database from 'better-sqlite3'
import { buildFtsMatchExpression } from './fts-sanitize'
import { buildItemFilterFragment, type SearchFilters } from './filters'

export interface FtsSearchHit {
  itemId: number
  /** Raw `bm25()` value — smaller/more negative is better. Debugging only; see file header. */
  rank: number
}

export interface FtsSearchOptions {
  userId: number
  query: string
  limit: number
  filters?: SearchFilters
}

/**
 * Returns `[]` (not an error) when `query` has no usable tokens (`buildFtsMatchExpression`
 * returns `null`) — an all-punctuation/emoji query is a valid, empty search, not a validation
 * failure; `q` itself being required/non-empty is enforced at the HTTP boundary
 * (`query-schema.ts`), not here.
 */
export function ftsSearch(sqlite: Database.Database, options: FtsSearchOptions): FtsSearchHit[] {
  if (options.limit <= 0) return []
  const matchExpression = buildFtsMatchExpression(options.query)
  if (!matchExpression) return []

  const filterFragment = buildItemFilterFragment(options.filters ?? {})
  const sql = `
    SELECT items.id AS itemId, bm25(items_fts) AS rank
      FROM items_fts
      JOIN items ON items.id = items_fts.rowid
     WHERE items_fts MATCH ? AND items.user_id = ?${filterFragment.sql}
     ORDER BY rank ASC
     LIMIT ?
  `
  const params: unknown[] = [
    matchExpression,
    options.userId,
    ...filterFragment.params,
    options.limit,
  ]
  return sqlite.prepare(sql).all(...params) as FtsSearchHit[]
}

/**
 * Plain-text excerpt around the match, via FTS5's own `snippet()` with empty highlight markers —
 * docs/API.md §3.2 requires plain text, never pre-highlighted HTML, so the client controls how
 * matched terms are visually marked. Column `-1` lets FTS5 auto-pick whichever declared column
 * (title/tldr/tags/content) actually matched, rather than assuming it was always `content` —
 * verified empirically to correctly prefer a title match over content when the match is there.
 *
 * Returns `null` when the item isn't itself an FTS match for `query` (e.g. a vector-only hit) —
 * callers fall back to a chunk-text excerpt in that case instead.
 */
export function ftsSnippet(
  sqlite: Database.Database,
  itemId: number,
  query: string,
): string | null {
  const matchExpression = buildFtsMatchExpression(query)
  if (!matchExpression) return null

  const row = sqlite
    .prepare(
      `SELECT snippet(items_fts, -1, '', '', '…', 24) AS s
         FROM items_fts
        WHERE items_fts.rowid = ? AND items_fts MATCH ?`,
    )
    .get(itemId, matchExpression) as { s: string } | undefined

  return row?.s && row.s.trim().length > 0 ? row.s : null
}

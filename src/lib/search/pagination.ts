/**
 * Opaque cursor for fused search results — a seek/keyset cursor over the RRF-fused ranking's own
 * sort key `(score DESC, id ASC)`, not an offset.
 *
 * docs/API.md §1.6 rules out offset pagination for every list endpoint ("silently skips or
 * repeats rows under concurrent writes"). A fused RRF score has no single backing SQL column to
 * seek on with a plain `WHERE id > ?`, since it's computed in application code from two separate
 * rankings — so this implements the same underlying idea ("resume strictly after the last row I
 * saw, in the established sort order") over the in-memory fused-and-sorted array instead of a SQL
 * `ORDER BY`. Concurrent inserts elsewhere in the ranking can't cause a previously-seen row to be
 * skipped or repeated, because the cursor is anchored to that row's own `(score, id)`, not to a
 * position count.
 */

export interface SearchCursor {
  /** The fused score of the last item on the previous page. */
  score: number
  /** That item's id — the tiebreak, since fused scores collide often at small corpus sizes. */
  id: number
}

export function encodeSearchCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

/**
 * Returns `undefined` for a missing/malformed cursor — callers treat that as "first page," never
 * a validation error. docs/API.md §1.6 already requires clients to treat cursors as opaque and
 * never hand-construct one; a garbled value is far more likely to be a stale/foreign cursor than
 * an attack, and "start over from page one" is a harmless failure mode for a search box.
 */
export function decodeSearchCursor(raw: string | undefined): SearchCursor | undefined {
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { score?: unknown }).score === 'number' &&
      typeof (parsed as { id?: unknown }).id === 'number'
    ) {
      return parsed as SearchCursor
    }
    return undefined
  } catch {
    return undefined
  }
}

function isStrictlyAfterCursor(
  item: { score: number; id: number },
  cursor: SearchCursor,
): boolean {
  if (item.score !== cursor.score) return item.score < cursor.score
  return item.id > cursor.id
}

function findFirstAfter(
  items: readonly { score: number; id: number }[],
  cursor: SearchCursor,
): number {
  const index = items.findIndex((item) => isStrictlyAfterCursor(item, cursor))
  return index === -1 ? items.length : index
}

/** Slices a fused, already-sorted `(score DESC, id ASC)` array to the page strictly after
 *  `cursor` (or the first page, when `cursor` is `undefined`). */
export function paginateFused<T extends { score: number; id: number }>(
  items: readonly T[],
  cursor: SearchCursor | undefined,
  limit: number,
): { page: T[]; hasMore: boolean } {
  const from = cursor ? findFirstAfter(items, cursor) : 0
  const page = items.slice(from, from + limit)
  const hasMore = from + limit < items.length
  return { page, hasMore }
}

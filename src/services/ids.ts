/**
 * Opaque wire ids (docs/API.md §1.3: "IDs are opaque strings with a type-prefix... Treat them as
 * opaque — don't parse structure out of them, don't construct them client-side"). Internally every
 * table uses a plain autoincrement integer primary key (schema.ts); this module is the ONLY place
 * that translates between that internal integer and the `itm_...` string the HTTP contract
 * promises. Routes/services should never format or parse an id any other way.
 */

const ITEM_PREFIX = 'itm_'

/** Internal row id -> wire id, e.g. `42` -> `"itm_42"`. */
export function toItemId(rowId: number): string {
  return `${ITEM_PREFIX}${rowId}`
}

/**
 * Wire id -> internal row id, or `null` if it isn't a validly-shaped item id — callers turn a
 * `null` into a 404 (docs/API.md: an id that doesn't parse and one that belongs to another user
 * are indistinguishable on purpose, so this deliberately doesn't throw).
 */
export function fromItemId(id: string): number | null {
  if (!id.startsWith(ITEM_PREFIX)) return null
  const rest = id.slice(ITEM_PREFIX.length)
  if (!/^[1-9][0-9]*$/.test(rest)) return null
  const rowId = Number.parseInt(rest, 10)
  return Number.isSafeInteger(rowId) ? rowId : null
}

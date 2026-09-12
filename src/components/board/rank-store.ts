/**
 * Client-side override store for manual board ordering, keyed by item id.
 *
 * WHY THIS EXISTS: `board_rank` (plan §10, P11.4) has no write path in the current backend.
 * Confirmed live against the running dev server while building this phase:
 *
 *   PATCH /api/v1/items/itm_1  { "board_rank": 42 }
 *   -> 400 VALIDATION_ERROR "(root): Unrecognized key: \"board_rank\""
 *
 * `ItemPatchSchema` in `src/services/items-schema.ts` is `.strict()` and simply has no
 * `board_rank` field, and `PATCH .../status` (`items-service.ts`) only ever writes `status`.
 * Rather than silently drop manual reordering, or fake a "saved" toast for something that isn't,
 * this persists the computed rank to `localStorage` so a manual order survives a reload on the
 * SAME device/browser — not synced across devices, and openly not the real thing, but a genuine
 * improvement over "resets on every refresh."
 *
 * THE FIX, once it's someone's turn to touch `src/services/**`: add
 * `board_rank: z.number().finite().optional()` to `ItemPatchSchema` and one line to `patchItem`
 * (`columnUpdates.boardRank = patch.board_rank`). The moment that lands, `persistRank` below is
 * the one function to change — swap its body for a `PATCH /api/v1/items/:id` call — and this
 * becomes a thin optimistic cache exactly like every other mutation in use-board-data.ts.
 *
 * Reads `localStorage` as a bare global (not `window.localStorage`) so a test can stub it with
 * `vi.stubGlobal('localStorage', fake)` without also faking a whole `window`.
 */

const STORAGE_KEY = 'sieve-board-rank-overrides'

type RankMap = Record<string, number>

function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function readAll(): RankMap {
  if (!hasLocalStorage()) return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const result: RankMap = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) result[id] = value
    }
    return result
  } catch {
    // Malformed JSON from a previous version of this store, or storage access denied — treat it
    // as "no overrides" rather than throwing; manual order just starts fresh.
    return {}
  }
}

function writeAll(map: RankMap): void {
  if (!hasLocalStorage()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Private browsing / quota exceeded / storage disabled. Never let a storage failure break
    // the reorder gesture itself — the in-memory query cache still reflects the new order for
    // the rest of this session, it just won't survive a reload.
  }
}

/** The rank to sort by: a local override if one exists, else the server's own (currently always-null) value. */
export function effectiveRank(itemId: string, serverRank: number | null): number | null {
  const overrides = readAll()
  const override = overrides[itemId]
  return override ?? serverRank
}

/** Called after computing a new rank for a manual reorder (see board-rank.ts). */
export function persistRank(itemId: string, rank: number): void {
  const overrides = readAll()
  overrides[itemId] = rank
  writeAll(overrides)
}

/** Drop the override for one item — e.g. once the server genuinely supports `board_rank` and has caught up. */
export function clearRank(itemId: string): void {
  const overrides = readAll()
  if (!(itemId in overrides)) return
  delete overrides[itemId]
  writeAll(overrides)
}

/** Test-only escape hatch to reset between cases. */
export function clearAllRanksForTests(): void {
  writeAll({})
}

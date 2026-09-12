/**
 * Pure cache-array transforms used by use-board-data.ts's mutations. Kept free of React Query
 * (or React) entirely so the actual data transformation logic — "what does the item list look
 * like after this move/patch, and how do we summarize a batch of settled requests" — is
 * unit-testable without constructing a `QueryClient`.
 */

export interface Identifiable {
  id: string
}

export function applyFieldPatch<T extends Identifiable>(
  items: readonly T[],
  itemId: string,
  patch: Partial<T>,
): T[] {
  return items.map((item) => (item.id === itemId ? { ...item, ...patch } : item))
}

export function applyStatusChange<T extends Identifiable & { status: string }>(
  items: readonly T[],
  itemId: string,
  nextStatus: T['status'],
): T[] {
  return applyFieldPatch(items, itemId, { status: nextStatus } as Partial<T>)
}

export function applyRankChange<T extends Identifiable & { board_rank: number | null }>(
  items: readonly T[],
  itemId: string,
  nextRank: number,
): T[] {
  return applyFieldPatch(items, itemId, { board_rank: nextRank } as Partial<T>)
}

export interface SettledBulkResult {
  succeeded: string[]
  failed: Array<{ id: string; message: string }>
}

/**
 * Pairs `Promise.allSettled` results back up with the ids that produced them (settled results
 * carry no identifying information of their own) and buckets them into succeeded/failed. The one
 * genuinely tricky bit of bulk-action bookkeeping, so it's isolated here rather than inlined in
 * the mutation hook.
 */
export function summarizeSettled(
  ids: readonly string[],
  settled: readonly PromiseSettledResult<unknown>[],
  messageFor: (reason: unknown) => string,
): SettledBulkResult {
  const succeeded: string[] = []
  const failed: SettledBulkResult['failed'] = []
  settled.forEach((result, index) => {
    const id = ids[index]
    if (id === undefined) return
    if (result.status === 'fulfilled') succeeded.push(id)
    else failed.push({ id, message: messageFor(result.reason) })
  })
  return { succeeded, failed }
}

/** Restore only the items that failed to their pre-mutation snapshot; leave successes applied. */
export function rollbackFailed<T extends Identifiable>(
  current: readonly T[],
  previous: readonly T[],
  failedIds: readonly string[],
): T[] {
  const failedSet = new Set(failedIds)
  const originalById = new Map(previous.map((item) => [item.id, item]))
  return current.map((item) =>
    failedSet.has(item.id) ? (originalById.get(item.id) ?? item) : item,
  )
}

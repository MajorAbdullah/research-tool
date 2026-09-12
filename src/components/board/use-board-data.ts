'use client'

/**
 * All server-state wiring for the board, in one place per frontend-best-practices.md's
 * "centralize API calls in a hooks/services layer": components below this file never call
 * `fetch` directly, they call one of these hooks.
 *
 * Every mutation follows the same optimistic-update-with-rollback shape (CLAUDE.md/UI-UX +
 * this phase's hard requirement): apply the change to the TanStack Query cache immediately
 * (`onMutate`), snapshot what was there before, and on failure (`onError`) restore exactly that
 * snapshot — visibly, via a toast, never a silent revert.
 */

import { useCallback } from 'react'
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import { toast } from '@/components/ui/use-toast'
import {
  ApiRequestError,
  fetchAllItems,
  fetchItemDetail,
  patchItemFields,
  patchItemStatus,
  type ItemDetailForBoard,
} from './api'
import {
  applyFieldPatch,
  applyRankChange,
  applyStatusChange,
  rollbackFailed,
  summarizeSettled,
  type SettledBulkResult,
} from './optimistic'
import { computeRankBetween, needsRebalance, rebalancedRanks } from './board-rank'
import { effectiveRank, persistRank } from './rank-store'
import type { ItemStatus, ItemSummary } from './board-types'

export const BOARD_ITEMS_QUERY_KEY = ['board', 'items'] as const
const ITEM_DETAIL_QUERY_KEY = (id: string) => ['board', 'item-detail', id] as const

function friendlyErrorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message
  return 'Something went wrong. Try again.'
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** The full board item set — every status, unfiltered. Columns/filters are derived client-side. */
export function useBoardItems() {
  return useQuery({
    queryKey: BOARD_ITEMS_QUERY_KEY,
    queryFn: fetchAllItems,
    staleTime: 15_000,
  })
}

/**
 * Outcome notes for a set of items (the Tested column), fetched lazily via item-detail requests
 * since `GET /api/v1/items` (ItemSummary) doesn't carry `outcome_note` at all — only the full
 * `Item`/`ItemWire` shape does (docs/API.md §2). One request per id, cached per id by React
 * Query, refetched only when the Tested set changes.
 */
export function useOutcomeNotes(itemIds: readonly string[]) {
  const results = useQueries({
    queries: itemIds.map((id) => ({
      queryKey: ITEM_DETAIL_QUERY_KEY(id),
      queryFn: () => fetchItemDetail(id),
      staleTime: 30_000,
    })),
  })

  const notes = new Map<string, string | null>()
  itemIds.forEach((id, index) => {
    const data = results[index]?.data
    if (data) notes.set(id, data.outcome_note)
  })
  return notes
}

// ---------------------------------------------------------------------------
// Write: status (column-changing drag, and the per-card status <select>)
// ---------------------------------------------------------------------------

export function useMoveItemStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ItemStatus }) => patchItemStatus(id, status),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: BOARD_ITEMS_QUERY_KEY })
      const previous = queryClient.getQueryData<ItemSummary[]>(BOARD_ITEMS_QUERY_KEY)
      queryClient.setQueryData<ItemSummary[]>(BOARD_ITEMS_QUERY_KEY, (current) =>
        current ? applyStatusChange(current, id, status) : current,
      )
      return { previous }
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(BOARD_ITEMS_QUERY_KEY, context.previous)
      toast({
        variant: 'destructive',
        title: "Couldn't move that item",
        description: friendlyErrorMessage(err),
      })
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ItemSummary[]>(BOARD_ITEMS_QUERY_KEY, (current) => {
        if (!current) return current
        // The server's `board_rank` is always null today (see rank-store.ts's comment) — spread
        // its response over the cached item for every OTHER field, but re-apply the local rank
        // override on top, or a same-tick reorder (dragging into a new column at a specific
        // index calls both this mutation and useReorderItem back to back — see board-view.tsx)
        // would get silently erased the instant this status change settles.
        const rank = effectiveRank(updated.id, updated.board_rank)
        return applyFieldPatch(current, updated.id, { ...updated, board_rank: rank })
      })
    },
  })
}

// ---------------------------------------------------------------------------
// Write: manual reorder within a column (local-only — see rank-store.ts)
// ---------------------------------------------------------------------------

/**
 * Returns a function that reorders `itemId` to `toIndex` within `columnItems` (the column's
 * current, already-sorted items, moved item included). Not a `useMutation` — there is nothing to
 * send to a server (see rank-store.ts), so there's no pending/error state to model; it's a
 * synchronous cache + localStorage write.
 */
export function useReorderItem() {
  const queryClient = useQueryClient()

  return useCallback(
    (columnItems: readonly ItemSummary[], itemId: string, toIndex: number) => {
      const withoutMoved = columnItems.filter((item) => item.id !== itemId)
      const before = withoutMoved[toIndex - 1] ?? null
      const after = withoutMoved[toIndex] ?? null
      const loRank = before ? effectiveRank(before.id, before.board_rank) : null
      const hiRank = after ? effectiveRank(after.id, after.board_rank) : null

      if (needsRebalance(loRank, hiRank)) {
        const orderedIds = [
          ...withoutMoved.slice(0, toIndex).map((item) => item.id),
          itemId,
          ...withoutMoved.slice(toIndex).map((item) => item.id),
        ]
        const withRanks = rebalancedRanks(orderedIds)
        for (const { id, rank } of withRanks) persistRank(id, rank)
        queryClient.setQueryData<ItemSummary[]>(BOARD_ITEMS_QUERY_KEY, (current) => {
          if (!current) return current
          let next = current
          for (const { id, rank } of withRanks) next = applyRankChange(next, id, rank)
          return next
        })
        return
      }

      const rank = computeRankBetween(loRank, hiRank)
      persistRank(itemId, rank)
      queryClient.setQueryData<ItemSummary[]>(BOARD_ITEMS_QUERY_KEY, (current) =>
        current ? applyRankChange(current, itemId, rank) : current,
      )
    },
    [queryClient],
  )
}

// ---------------------------------------------------------------------------
// Write: outcome note (Tested column's payoff — worked / didn't / why)
// ---------------------------------------------------------------------------

export function useUpdateOutcomeNote() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, outcomeNote }: { id: string; outcomeNote: string | null }) =>
      patchItemFields(id, { outcome_note: outcomeNote }),
    onMutate: async ({ id, outcomeNote }) => {
      const key = ITEM_DETAIL_QUERY_KEY(id)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<ItemDetailForBoard>(key)
      queryClient.setQueryData<ItemDetailForBoard>(key, { id, outcome_note: outcomeNote })
      return { previous, id }
    },
    onError: (err, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(ITEM_DETAIL_QUERY_KEY(context.id), context.previous)
      toast({
        variant: 'destructive',
        title: "Couldn't save that note",
        description: friendlyErrorMessage(err),
      })
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(ITEM_DETAIL_QUERY_KEY(updated.id), {
        id: updated.id,
        outcome_note: updated.outcome_note,
      })
    },
  })
}

// ---------------------------------------------------------------------------
// Write: bulk actions (move / archive / tag)
// ---------------------------------------------------------------------------

function bulkResultToast(verb: string, result: SettledBulkResult): void {
  if (result.failed.length === 0) {
    toast({ variant: 'success', title: `${verb} ${pluralize(result.succeeded.length, 'item')}` })
    return
  }
  if (result.succeeded.length === 0) {
    toast({
      variant: 'destructive',
      title: `Couldn't ${verb.toLowerCase()} ${pluralize(result.failed.length, 'item')}`,
      description: result.failed[0]?.message,
    })
    return
  }
  toast({
    variant: 'warning',
    title: `${verb} ${pluralize(result.succeeded.length, 'item')}, ${pluralize(result.failed.length, 'item')} failed`,
    description: result.failed[0]?.message,
  })
}

/** Shared fan-out: optimistic apply-to-all, issue requests, roll back only the ones that failed. */
async function runBulk(
  queryClient: QueryClient,
  ids: string[],
  optimisticApply: (current: ItemSummary[]) => ItemSummary[],
  request: (id: string) => Promise<unknown>,
): Promise<SettledBulkResult> {
  const previous = queryClient.getQueryData<ItemSummary[]>(BOARD_ITEMS_QUERY_KEY)
  queryClient.setQueryData<ItemSummary[]>(BOARD_ITEMS_QUERY_KEY, (current) =>
    current ? optimisticApply(current) : current,
  )

  const settled = await Promise.allSettled(ids.map((id) => request(id)))
  const result = summarizeSettled(ids, settled, friendlyErrorMessage)

  if (result.failed.length > 0 && previous) {
    const failedIds = result.failed.map((f) => f.id)
    queryClient.setQueryData<ItemSummary[]>(BOARD_ITEMS_QUERY_KEY, (current) =>
      current ? rollbackFailed(current, previous, failedIds) : current,
    )
  }

  return result
}

export function useBulkMoveStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: ItemStatus }) =>
      runBulk(
        queryClient,
        ids,
        (current) => ids.reduce((acc, id) => applyStatusChange(acc, id, status), current),
        (id) => patchItemStatus(id, status),
      ),
    onSuccess: (result, { status }) => {
      const verb = status === 'archived' ? 'Archived' : status === 'dropped' ? 'Dropped' : 'Moved'
      bulkResultToast(verb, result)
    },
  })
}

function unionTag(tags: string[], tag: string): string[] {
  return tags.includes(tag) ? tags : [...tags, tag]
}

export function useBulkAddTag() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ ids, tag }: { ids: string[]; tag: string }) => {
      const current = queryClient.getQueryData<ItemSummary[]>(BOARD_ITEMS_QUERY_KEY) ?? []
      const tagsById = new Map(current.map((item) => [item.id, unionTag(item.tags, tag)]))
      return runBulk(
        queryClient,
        ids,
        (items) =>
          ids.reduce((acc, id) => {
            const nextTags = tagsById.get(id)
            return nextTags ? applyFieldPatch(acc, id, { tags: nextTags }) : acc
          }, items),
        (id) => patchItemFields(id, { tags: tagsById.get(id) ?? [] }),
      )
    },
    onSuccess: (result) => bulkResultToast('Tagged', result),
  })
}

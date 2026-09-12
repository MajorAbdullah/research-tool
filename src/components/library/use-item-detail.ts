'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchItemDetail,
  patchItem,
  retryItemStage,
  type ItemDetail,
  type ItemPatchInput,
  type RetryStage,
} from '@/components/library/api-client'
import { toast } from '@/components/ui/use-toast'

function itemQueryKey(id: string) {
  return ['item', id] as const
}

const RETRY_STAGE_LABEL: Record<RetryStage, string> = {
  extract: 'Re-extract',
  enrich: 'Re-enrich',
}

/**
 * Item detail's one data source: the item itself (seeded from the server-rendered page, per
 * deliverable #6-11) plus the two mutations every editable control on the page shares —
 * `PATCH .../items/:id` (note/star/tags/topic — deliverable #10, optimistic) and
 * `POST .../items/:id/retry` (deliverable #11). Both funnel through this one hook so every
 * caller (star button, note editor, tag/topic editor, retry buttons) rolls back and reports
 * errors identically instead of each reinventing the optimistic-update dance.
 */
export function useItemDetail(id: string, initialItem: ItemDetail) {
  const queryClient = useQueryClient()
  const queryKey = itemQueryKey(id)

  const itemQuery = useQuery({
    queryKey,
    queryFn: () => fetchItemDetail(id),
    initialData: initialItem,
  })

  const patchMutation = useMutation({
    mutationFn: (patch: ItemPatchInput) => patchItem(id, patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<ItemDetail>(queryKey)
      if (previous) {
        // `topic` is deliberately excluded from the optimistic merge: the request sends a plain
        // slug string, but the cached shape needs the full `Topic` object (label/color/confidence)
        // that only the server response actually knows (topics.ts assigns color deterministically
        // server-side) — a topic edit renders once the real response lands in `onSuccess` below,
        // rather than flashing a fabricated placeholder label. note/starred/tags/outcome_note are
        // the same shape on both sides, so those apply immediately.
        const { topic: _topic, ...optimisticFields } = patch
        queryClient.setQueryData<ItemDetail>(queryKey, { ...previous, ...optimisticFields })
      }
      return { previous }
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous)
      toast({
        variant: 'destructive',
        title: "Couldn't save your change",
        description: 'Nothing else was affected — try again in a moment.',
      })
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data)
    },
  })

  const retryMutation = useMutation({
    mutationFn: (stage: RetryStage) => retryItemStage(id, stage),
    onSuccess: (result) => {
      queryClient.setQueryData<ItemDetail>(queryKey, (prev) =>
        prev ? { ...prev, status: result.status } : prev,
      )
      toast({
        variant: 'success',
        title: `${RETRY_STAGE_LABEL[result.stage]} queued`,
        description: 'The pipeline is running again — this usually takes under a minute.',
      })
    },
    onError: (err) => {
      const isConflict =
        typeof err === 'object' && err !== null && 'code' in err && err.code === 'CONFLICT'
      toast({
        variant: isConflict ? 'warning' : 'destructive',
        title: isConflict ? 'Already running' : 'Retry failed',
        description: isConflict
          ? 'A job for this item at this stage is already in progress.'
          : 'Nothing was lost — try again in a moment.',
      })
    },
  })

  return {
    item: itemQuery.data,
    isLoading: itemQuery.isLoading,
    isError: itemQuery.isError,
    refetch: itemQuery.refetch,
    patch: patchMutation.mutate,
    isPatching: patchMutation.isPending,
    retry: (stage: RetryStage) => retryMutation.mutate(stage),
    isRetrying: retryMutation.isPending,
    retryingStage: retryMutation.variables,
  }
}

'use client'

/**
 * The board's top-level orchestrator: owns filter/selection state, derives the five columns (plus
 * the read-only pipeline strip) from the one fetched item list, and wires the drag controller to
 * the actual mutations. Rendered by board-page.tsx inside its own `QueryClientProvider`.
 */

import { useMemo, useState } from 'react'
import { Inbox, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { LoadingGrid } from '@/components/common/loading-grid'
import { applyFilters, collectTopics } from './board-filters'
import { sortForColumn } from './board-rank'
import { effectiveRank } from './rank-store'
import {
  BOARD_COLUMNS,
  EMPTY_FILTERS,
  columnByKey,
  isPipelineStatus,
  type BoardFilters,
  type ItemSummary,
  type OutcomeNoteState,
} from './board-types'
import { canDropOnColumn, isValidTransition } from './status-transitions'
import { DragProvider, type DragDropResult } from './drag-controller'
import { DragGhost } from './drag-ghost'
import { BoardToolbar } from './board-toolbar'
import { PipelineStrip } from './pipeline-strip'
import { BoardColumn } from './board-column'
import { BulkActionBar } from './bulk-action-bar'
import { MobileCarousel } from './mobile-carousel'
import { useBoardItems, useMoveItemStatus, useOutcomeNotes, useReorderItem } from './use-board-data'

export function BoardView() {
  const { data, isPending, isError, refetch } = useBoardItems()
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const moveStatus = useMoveItemStatus()
  const reorder = useReorderItem()

  const allItems = useMemo(() => data ?? [], [data])
  const pipelineItems = useMemo(
    () => allItems.filter((item) => isPipelineStatus(item.status)),
    [allItems],
  )
  const boardItems = useMemo(
    () => allItems.filter((item) => !isPipelineStatus(item.status)),
    [allItems],
  )
  const filteredItems = useMemo(() => applyFilters(boardItems, filters), [boardItems, filters])
  const topics = useMemo(() => collectTopics(boardItems), [boardItems])

  const itemsByColumn = useMemo(() => {
    const map = new Map<string, ItemSummary[]>()
    for (const column of BOARD_COLUMNS) {
      const statuses = column.statuses as readonly string[]
      const inColumn = filteredItems.filter((item) => statuses.includes(item.status))
      map.set(
        column.key,
        sortForColumn(
          inColumn,
          (item) => effectiveRank(item.id, item.board_rank),
          (item) => item.created_at,
        ),
      )
    }
    return map
  }, [filteredItems])

  const testedIds = useMemo(
    () => (itemsByColumn.get('tested') ?? []).map((item) => item.id),
    [itemsByColumn],
  )
  const outcomeNotesResolved = useOutcomeNotes(testedIds)
  const outcomeNotes = useMemo(() => {
    const map = new Map<string, OutcomeNoteState>()
    for (const id of testedIds) map.set(id, outcomeNotesResolved.get(id))
    return map
  }, [testedIds, outcomeNotesResolved])

  const selectedItems = useMemo(
    () => allItems.filter((item) => selectedIds.has(item.id)),
    [allItems, selectedIds],
  )

  function toggleSelect(id: string): void {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleDrop(result: DragDropResult): void {
    const { itemId, fromColumn, toColumn, toIndex } = result
    const item = boardItems.find((candidate) => candidate.id === itemId)
    if (!item) return

    const targetItems = itemsByColumn.get(toColumn) ?? []

    if (fromColumn === toColumn) {
      reorder(targetItems, itemId, toIndex)
      return
    }

    const targetConfig = columnByKey(toColumn)
    const targetStatuses = targetConfig.statuses as readonly string[]
    const targetStatus = targetStatuses.includes(item.status)
      ? item.status
      : targetConfig.defaultDropStatus

    // Defensive re-check: the drag controller already refuses to call onDrop for a column
    // canDropOnColumn ruled out, so this should never actually fire — but a stale closure or a
    // future change to that gate should fail safe (no-op) rather than send a request already
    // known to be doomed.
    if (!isValidTransition(item.status, targetStatus)) return

    moveStatus.mutate({ id: itemId, status: targetStatus })
    reorder(targetItems, itemId, toIndex)
  }

  if (isPending) {
    return (
      <div className="p-4">
        <LoadingGrid count={5} />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-4">
        <ErrorState
          title="Couldn't load the board"
          description="The request failed. Nothing was lost — try again in a moment."
          action={
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Try again
            </Button>
          }
        />
      </div>
    )
  }

  if (allItems.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          icon={Inbox}
          title="Nothing on the board yet"
          description="Capture a link from the extension, the share sheet, or the paste box. Once the pipeline finishes with it, it lands in Inbox."
        />
      </div>
    )
  }

  return (
    <DragProvider canDropOn={canDropOnColumn} onDrop={handleDrop}>
      <div className="flex flex-col gap-3 p-3 pb-4 md:p-4">
        <BoardToolbar filters={filters} onChange={setFilters} topics={topics} />
        <PipelineStrip items={pipelineItems} />

        {filteredItems.length === 0 && pipelineItems.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No items match these filters"
            description="Try a broader kind or topic, or reset the filters above."
            className="mt-2"
          />
        ) : (
          <>
            {/*
              Column height is capped in viewport units directly (see board-column.tsx) rather
              than propagated through flex-1/min-h-0 from this ancestor chain: layout.tsx's
              <main> (out of this phase's scope to edit) doesn't itself set min-h-0, and relying
              on that propagating correctly through an ancestor this phase can't touch is fragile.
              vh-based caps are self-contained and don't need it. The page may scroll vertically
              if content is tall — only horizontal scroll at 390px is the hard requirement.
            */}
            <div className="hidden gap-3 md:grid md:grid-cols-5 md:items-start">
              {BOARD_COLUMNS.map((column) => (
                <BoardColumn
                  key={column.key}
                  config={column}
                  items={itemsByColumn.get(column.key) ?? []}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  outcomeNotes={outcomeNotes}
                />
              ))}
            </div>

            <div className="md:hidden">
              <MobileCarousel
                columns={BOARD_COLUMNS}
                itemsByColumn={itemsByColumn}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                outcomeNotes={outcomeNotes}
              />
            </div>
          </>
        )}
      </div>

      <DragGhost items={boardItems} />
      <BulkActionBar selectedItems={selectedItems} onClear={() => setSelectedIds(new Set())} />
    </DragProvider>
  )
}

'use client'

/**
 * Bulk select -> move / archive / tag (plan §10, P11.6: "10 items archived in one action").
 * Appears once at least one card is selected (board-card.tsx's per-card checkbox). "Move to" only
 * offers statuses reachable from EVERY selected item (status-transitions.ts's
 * `commonAllowedNextStatuses`) — a mixed selection naturally narrows to whatever is legal for all
 * of them (e.g. one Archived + one Testing item only ever have "Inbox" in common), so this never
 * needs to attempt a move the server would reject for part of the batch.
 */

import { useState } from 'react'
import { Archive, Tag, Trash2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { STATUS_LABELS, type ItemStatus, type ItemSummary } from './board-types'
import { commonAllowedNextStatuses } from './status-transitions'
import { useBulkAddTag, useBulkMoveStatus } from './use-board-data'

export interface BulkActionBarProps {
  selectedItems: readonly ItemSummary[]
  onClear: () => void
}

export function BulkActionBar({ selectedItems, onClear }: BulkActionBarProps) {
  const [moveTarget, setMoveTarget] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const bulkMove = useBulkMoveStatus()
  const bulkTag = useBulkAddTag()

  if (selectedItems.length === 0) return null

  const ids = selectedItems.map((item) => item.id)
  const commonNext = commonAllowedNextStatuses(selectedItems.map((item) => item.status))

  function handleMove(): void {
    if (!moveTarget) return
    bulkMove.mutate({ ids, status: moveTarget as ItemStatus })
    setMoveTarget('')
    onClear()
  }

  function handleShortcut(status: ItemStatus): void {
    if (!commonNext.includes(status)) return
    bulkMove.mutate({ ids, status })
    onClear()
  }

  function handleAddTag(): void {
    const tag = tagDraft.trim()
    if (!tag) return
    bulkTag.mutate({ ids, tag })
    setTagDraft('')
    onClear()
  }

  return (
    <div
      className="fixed inset-x-4 bottom-[calc(4rem+0.5rem)] z-30 mx-auto flex max-w-2xl flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 shadow-lg md:right-4 md:bottom-4 md:left-auto md:mx-0"
      role="toolbar"
      aria-label="Bulk actions"
    >
      <span className="text-sm font-medium text-foreground">{selectedItems.length} selected</span>

      <div className="flex flex-1 flex-wrap items-center gap-2">
        {commonNext.length > 0 ? (
          <>
            <Select
              aria-label="Move selected items to"
              value={moveTarget}
              onChange={(event) => setMoveTarget(event.target.value)}
              className="h-9 w-40"
            >
              <option value="">Move to…</option>
              {commonNext.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="outline" disabled={!moveTarget} onClick={handleMove}>
              Move
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            No move is valid for this mixed selection.
          </span>
        )}

        {commonNext.includes('archived') && (
          <Button size="sm" variant="outline" onClick={() => handleShortcut('archived')}>
            <Archive className="size-4" aria-hidden="true" />
            Archive
          </Button>
        )}
        {commonNext.includes('dropped') && (
          <Button size="sm" variant="outline" onClick={() => handleShortcut('dropped')}>
            <Trash2 className="size-4" aria-hidden="true" />
            Drop
          </Button>
        )}

        <div className="flex items-center gap-1.5">
          <Input
            aria-label="Add a tag to selected items"
            placeholder="Add tag…"
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                handleAddTag()
              }
            }}
            className="h-9 w-32"
          />
          <Button size="sm" variant="outline" disabled={!tagDraft.trim()} onClick={handleAddTag}>
            <Tag className="size-4" aria-hidden="true" />
            Add
          </Button>
        </div>
      </div>

      <Button size="icon" variant="ghost" aria-label="Clear selection" onClick={onClear}>
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  )
}

'use client'

/**
 * One board column: header (label + count), its cards in order, the empty state, and the visual
 * drop feedback (dimmed when a drag in progress can't legally land here, an insertion line at the
 * hovered index when it can).
 */

import { useEffect } from 'react'
import { Inbox } from 'lucide-react'

import { EmptyState } from '@/components/common/empty-state'
import { cn } from '@/lib/utils'
import { BoardCard } from './board-card'
import { useDragController } from './drag-controller'
import { useReorderItem } from './use-board-data'
import type { BoardColumnConfig, ItemSummary, OutcomeNoteState } from './board-types'

export interface BoardColumnProps {
  config: BoardColumnConfig
  items: readonly ItemSummary[]
  selectedIds: ReadonlySet<string>
  onToggleSelect: (id: string) => void
  outcomeNotes?: ReadonlyMap<string, OutcomeNoteState>
  className?: string
}

export function BoardColumn({
  config,
  items,
  selectedIds,
  onToggleSelect,
  outcomeNotes,
  className,
}: BoardColumnProps) {
  const { dragState, isColumnAllowed, registerColumnEl, registerItemEl, registerColumnItemIds } =
    useDragController()
  const reorder = useReorderItem()

  useEffect(() => {
    registerColumnItemIds(
      config.key,
      items.map((item) => item.id),
    )
  }, [config.key, items, registerColumnItemIds])

  const allowed = isColumnAllowed(config.key)
  const isDragActive = dragState !== null
  const isDropTarget = dragState?.overColumn === config.key && allowed

  function handleMove(id: string, direction: 'up' | 'down'): void {
    const idx = items.findIndex((item) => item.id === id)
    if (idx === -1) return
    const toIndex = direction === 'up' ? idx - 1 : idx + 1
    if (toIndex < 0 || toIndex >= items.length) return
    reorder(items, id, toIndex)
  }

  return (
    <div
      ref={(el) => registerColumnEl(config.key, el)}
      data-board-column={config.key}
      className={cn(
        'flex max-h-[70vh] w-full flex-col rounded-lg border border-border bg-muted/30 transition-opacity md:max-h-[calc(100vh-13rem)]',
        isDragActive && !allowed && 'pointer-events-none opacity-40',
        isDropTarget && 'ring-2 ring-primary/60',
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between px-3 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">{config.label}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {items.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Nothing here"
            description="Drag a card in, or change its status from the card menu."
            className="border-none bg-transparent p-4 text-xs"
          />
        ) : (
          items.map((item, index) => (
            <div key={item.id} className="relative">
              {isDropTarget && dragState?.overIndex === index && (
                <div className="absolute -top-1.5 right-0 left-0 h-1 rounded-full bg-primary" />
              )}
              <BoardCard
                item={item}
                column={config.key}
                selected={selectedIds.has(item.id)}
                onToggleSelect={onToggleSelect}
                isDragging={dragState?.itemId === item.id}
                onMove={handleMove}
                canMoveUp={index > 0}
                canMoveDown={index < items.length - 1}
                outcomeNote={outcomeNotes?.get(item.id)}
                registerEl={registerItemEl}
              />
            </div>
          ))
        )}
        {isDropTarget && dragState?.overIndex === items.length && (
          <div className="h-1 rounded-full bg-primary" />
        )}
      </div>
    </div>
  )
}

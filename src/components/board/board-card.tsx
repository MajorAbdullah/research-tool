'use client'

/**
 * One draggable unit on the board. Wraps P5's `ItemCard` (its own doc comment already names
 * "board columns" as one of its intended surfaces) rather than reimplementing card content —
 * this phase's brief is "reuse the design system; invent nothing new" — and adds only the chrome
 * a board card needs on top: a bulk-select checkbox, a drag handle, the accessible status
 * `<select>` (the keyboard/screen-reader alternative to dragging), a kebab menu for keyboard
 * reordering, and — on Tested cards only — the outcome-note editor.
 *
 * No `href` is passed to `ItemCard`: item detail is P10/library's route, not this phase's, and
 * `ItemCard`'s stretched-link pattern would otherwise compete for clicks with the controls laid
 * over it here.
 */

import { ArrowDown, ArrowUp, GripVertical, MoreVertical } from 'lucide-react'

import { ItemCard } from '@/components/common/item-card'
import { Checkbox } from '@/components/ui/checkbox'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useDragHandle } from './drag-controller'
import { allowedNextStatuses } from './status-transitions'
import { useMoveItemStatus } from './use-board-data'
import { OutcomeNoteEditor } from './outcome-note-editor'
import {
  STATUS_LABELS,
  type BoardColumnKey,
  type ItemStatus,
  type ItemSummary,
  type OutcomeNoteState,
} from './board-types'

export interface BoardCardProps {
  item: ItemSummary
  column: BoardColumnKey
  selected: boolean
  onToggleSelect: (id: string) => void
  isDragging: boolean
  onMove: (id: string, direction: 'up' | 'down') => void
  canMoveUp: boolean
  canMoveDown: boolean
  outcomeNote?: OutcomeNoteState
  registerEl: (id: string, el: HTMLElement | null) => void
}

export function BoardCard({
  item,
  column,
  selected,
  onToggleSelect,
  isDragging,
  onMove,
  canMoveUp,
  canMoveDown,
  outcomeNote,
  registerEl,
}: BoardCardProps) {
  const handle = useDragHandle(item.id, item.status, column)
  const moveStatus = useMoveItemStatus()
  const nextStatuses = allowedNextStatuses(item.status)
  const statusOptions: ItemStatus[] = [item.status, ...nextStatuses]

  function handleStatusChange(next: string): void {
    if (next === item.status) return
    moveStatus.mutate({ id: item.id, status: next as ItemStatus })
  }

  return (
    <div
      ref={(el) => registerEl(item.id, el)}
      data-board-card-id={item.id}
      className={cn(
        'flex flex-col gap-1.5 rounded-lg transition-opacity',
        isDragging && 'opacity-40',
      )}
    >
      <div className="relative">
        <div className="absolute top-2 left-2 z-10">
          <Checkbox
            checked={selected}
            onChange={() => onToggleSelect(item.id)}
            aria-label={`Select "${item.title ?? 'Untitled'}"`}
            className="rounded-md bg-background/90 shadow-sm backdrop-blur-sm"
          />
        </div>
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
          {/*
            Pointer/touch-only affordance, deliberately out of the tab order: the "Move up"/"Move
            down" menu items and the status <select> below are the full keyboard-operable path for
            everything this handle does, so a focusable-but-inert button here would be a worse
            a11y experience than removing it from that tree entirely (see the phase report).
          */}
          <button
            type="button"
            {...handle}
            tabIndex={-1}
            aria-hidden="true"
            className={cn(
              'flex size-touch cursor-grab items-center justify-center rounded-md bg-background/90 text-muted-foreground shadow-sm backdrop-blur-sm active:cursor-grabbing',
            )}
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger>
              <button
                type="button"
                aria-label="More actions"
                className={cn(
                  'flex size-touch items-center justify-center rounded-md bg-background/90 text-muted-foreground shadow-sm backdrop-blur-sm',
                  'outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <MoreVertical className="size-4" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem disabled={!canMoveUp} onSelect={() => onMove(item.id, 'up')}>
                <ArrowUp className="size-4" aria-hidden="true" />
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canMoveDown} onSelect={() => onMove(item.id, 'down')}>
                <ArrowDown className="size-4" aria-hidden="true" />
                Move down
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <ItemCard item={item} />
      </div>

      <div className="space-y-1 px-0.5">
        <Label htmlFor={`status-${item.id}`} className="sr-only">
          Status for {item.title ?? 'this item'}
        </Label>
        <Select
          id={`status-${item.id}`}
          value={item.status}
          disabled={nextStatuses.length === 0 || moveStatus.isPending}
          onChange={(event) => handleStatusChange(event.target.value)}
        >
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </div>

      {item.status === 'tested' && (
        <OutcomeNoteEditor
          itemId={item.id}
          itemTitle={item.title}
          value={outcomeNote}
          className="mx-0.5"
        />
      )}
    </div>
  )
}

'use client'

/**
 * The floating preview that follows the pointer during a drag. Deliberately a small, simplified
 * chip (kind + title) rather than a full `ItemCard` clone — the card left behind in its column
 * (see board-card.tsx's `isDragging` dimmed state) already shows the full content, so the ghost's
 * only job is "confirm what's being carried and where the pointer is," not duplicate the card.
 * Positioned a little above the pointer so a finger on a touchscreen doesn't sit directly on top
 * of the thing it's supposed to be able to see.
 */

import {
  AudioLines,
  FileText,
  FolderGit2,
  Globe,
  MessageCircle,
  Newspaper,
  Video,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { useDragController } from './drag-controller'
import type { ItemKind, ItemSummary } from './board-types'

const KIND_ICON: Record<ItemKind, typeof FolderGit2> = {
  github: FolderGit2,
  video: Video,
  article: Newspaper,
  social: MessageCircle,
  pdf: FileText,
  audio: AudioLines,
  other: Globe,
}

export interface DragGhostProps {
  items: readonly ItemSummary[]
}

export function DragGhost({ items }: DragGhostProps) {
  const { dragState } = useDragController()
  if (!dragState) return null

  const item = items.find((i) => i.id === dragState.itemId)
  if (!item) return null

  const Icon = KIND_ICON[item.kind]

  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none fixed z-50 flex max-w-64 -translate-x-1/2 -translate-y-[calc(100%+16px)]',
        'items-center gap-2 rounded-lg border border-primary bg-card px-3 py-2 text-card-foreground shadow-lg',
      )}
      style={{ left: dragState.currentX, top: dragState.currentY }}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate text-sm font-medium">{item.title ?? 'Untitled'}</span>
    </div>
  )
}

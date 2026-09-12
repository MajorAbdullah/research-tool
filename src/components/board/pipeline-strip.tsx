'use client'

/**
 * Read-only indicator for `queued`/`processing`/`failed` items — pipeline-owned states per
 * docs/API.md §3.6 (no outgoing transition through `PATCH .../status` exists for any of them, and
 * the server rejects an attempt with `400 INVALID_STATUS_TRANSITION`). They are deliberately NOT
 * a draggable column (this phase's brief: "they are NOT draggable columns, and the API rejects
 * transitions into them") but CLAUDE.md's UI/UX section is equally explicit that the user must
 * stay informed of system status — so a freshly-captured item that hasn't reached Inbox yet is
 * still visible somewhere, instead of just "missing" from the board.
 *
 * Collapsed by default to a small summary chip; expands to a horizontal scroll of compact,
 * non-interactive rows. No status `<select>`/drag handle/checkbox here — none would do anything
 * (the transition list for all three statuses is empty), so none are shown.
 */

import { useState } from 'react'
import { ChevronDown, ChevronUp, LoaderCircle, TriangleAlert } from 'lucide-react'

import { KindBadge } from '@/components/common/kind-badge'
import { StatusPill } from '@/components/common/status-pill'
import { cn } from '@/lib/utils'
import type { ItemSummary } from './board-types'

export interface PipelineStripProps {
  items: readonly ItemSummary[]
  className?: string
}

export function PipelineStrip({ items, className }: PipelineStripProps) {
  const [expanded, setExpanded] = useState(false)
  if (items.length === 0) return null

  const failedCount = items.filter((item) => item.status === 'failed').length
  const inFlightCount = items.length - failedCount

  return (
    <div className={cn('rounded-lg border border-border bg-card', className)}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          'flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm',
          'outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <span className="flex items-center gap-3 font-medium text-foreground">
          {inFlightCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              {inFlightCount} in pipeline
            </span>
          )}
          {failedCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-destructive">
              <TriangleAlert className="size-4" aria-hidden="true" />
              {failedCount} failed
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronUp className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </button>

      {expanded && (
        <div className="flex gap-2 overflow-x-auto border-t border-border p-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex w-56 shrink-0 items-center gap-2 rounded-md border border-border bg-muted/40 p-2"
            >
              <KindBadge kind={item.kind} />
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                {item.title ?? 'Untitled'}
              </span>
              <StatusPill status={item.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

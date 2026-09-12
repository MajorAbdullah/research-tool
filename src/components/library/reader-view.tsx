'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export interface ReaderViewProps {
  title: string
  content: string
}

/**
 * Deliverable #9 — collapsible reader for `content_text`/transcript. Collapsed by default at a
 * fixed max-height with a fade-out cue (long transcripts routinely run to thousands of words —
 * plan §10.2.4's "long transcripts don't break layout" is exactly this: never let raw text push
 * the rest of the page down by default). `whitespace-pre-wrap` preserves a transcript's own line
 * breaks without ever needing horizontal scroll — text wraps, it never truncates a line instead.
 */
export function ReaderView({ title, content }: ReaderViewProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-border">
      <Button
        variant="ghost"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="w-full justify-between rounded-b-none px-4 font-semibold"
      >
        {title}
        {expanded ? (
          <ChevronUp className="size-4" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-4" aria-hidden="true" />
        )}
      </Button>
      <div
        className={cn(
          'relative overflow-hidden border-t border-border bg-card px-4 py-4 text-sm whitespace-pre-wrap text-foreground',
          expanded ? 'max-h-none' : 'max-h-48',
        )}
      >
        {content}
        {!expanded && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent"
          />
        )}
      </div>
    </div>
  )
}

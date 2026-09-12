'use client'

/**
 * Per-item outcome note on Tested (plan §10, P11.7): "worked / didn't / why." This is the payoff
 * the whole board exists for — CLAUDE.md's brief is explicit that a month later you want to know
 * *why* you dropped or kept something, so this stays visible and editable directly on the card,
 * not buried behind an item-detail page this phase doesn't own.
 *
 * `value` is `OutcomeNoteState`: `undefined` while the lazy per-item fetch is in flight
 * (use-board-data.ts's `useOutcomeNotes` — `GET /api/v1/items` doesn't carry `outcome_note`, only
 * item detail does), `null` once fetched and genuinely empty, a string once set.
 */

import { useState } from 'react'
import { MessageSquarePlus, Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useUpdateOutcomeNote } from './use-board-data'
import type { OutcomeNoteState } from './board-types'

export interface OutcomeNoteEditorProps {
  itemId: string
  itemTitle: string | null
  value: OutcomeNoteState
  className?: string
}

export function OutcomeNoteEditor({ itemId, itemTitle, value, className }: OutcomeNoteEditorProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const mutation = useUpdateOutcomeNote()

  // Re-seed the draft from the latest known value at the moment the dialog opens — done directly
  // in the event handler that flips `open`, not in a `useEffect` reacting to it: this is a
  // response to a user action, not a synchronization with an external system, and doing it here
  // avoids the extra render pass an effect-based reset would cause.
  function handleOpenChange(next: boolean): void {
    if (next) setDraft(value ?? '')
    setOpen(next)
  }

  if (value === undefined) {
    return <Skeleton className={cn('h-9 w-full', className)} />
  }

  async function handleSave(): Promise<void> {
    await mutation.mutateAsync({ id: itemId, outcomeNote: draft.trim().length > 0 ? draft : null })
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger>
        {value ? (
          <button
            type="button"
            className={cn(
              'flex min-h-11 w-full items-start gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-2 text-left text-xs',
              'outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
              className,
            )}
          >
            <Pencil className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="line-clamp-2 text-muted-foreground">{value}</span>
          </button>
        ) : (
          <Button variant="outline" size="sm" className={cn('w-full', className)}>
            <MessageSquarePlus className="size-4" aria-hidden="true" />
            Add outcome
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Outcome</DialogTitle>
          <DialogDescription>
            {itemTitle ? (
              <>
                Worked? Didn&rsquo;t? Why — for{' '}
                <strong className="text-foreground">{itemTitle}</strong>.
              </>
            ) : (
              'Worked? Didn’t? Why?'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraft((current) => (current.length > 0 ? current : 'Worked — '))}
            >
              Worked
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setDraft((current) => (current.length > 0 ? current : "Didn't work — "))
              }
            >
              Didn&rsquo;t work
            </Button>
          </div>
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="What happened when you tried it, and why keep or drop it?"
            rows={4}
            autoFocus
            aria-label="Outcome note"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

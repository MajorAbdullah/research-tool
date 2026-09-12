'use client'

/**
 * The quick-capture confirmation screen (plan 8.5): lands here after the PWA share target
 * redirects (`src/app/share/route.ts`), or can be linked to directly after any capture. Shows
 * what was saved, offers "add a note," and auto-dismisses back to the paste box after a couple of
 * seconds — paused while the user is actively writing a note, per the "feels instant on phone"
 * goal without cutting off someone mid-sentence.
 */

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CircleCheck, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { KindBadge } from '@/components/common/kind-badge'
import { StatusPill } from '@/components/common/status-pill'
import { ExtractionTierWarning } from '@/components/common/extraction-tier-warning'
import type { ItemWire } from '@/services/wire-types'

const AUTO_DISMISS_MS = 2_500

const ERROR_MESSAGES: Record<string, string> = {
  no_url: "We couldn't find a link in what was shared.",
  bad_request: "That share didn't come through correctly.",
  failed: 'Something went wrong saving that link. Try again from the share sheet.',
}

export function ConfirmClient() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const id = searchParams.get('id')
  const duplicate = searchParams.get('duplicate') === 'true'
  const error = searchParams.get('error')

  const [item, setItem] = useState<ItemWire | null>(null)
  const [note, setNote] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [noteSaved, setNoteSaved] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    void fetch(`/api/v1/items/${id}`, { headers: { Accept: 'application/json' } })
      .then((response) => (response.ok ? (response.json() as Promise<ItemWire>) : null))
      .then((data) => {
        if (!cancelled) setItem(data)
      })
      .catch(() => {
        // The item almost certainly still saved — capture already returned 202 before this page
        // ever loaded. A failed detail fetch here just means the summary card doesn't render;
        // it must never look like the capture itself failed.
      })
    return () => {
      cancelled = true
    }
  }, [id])

  // Auto-dismiss unless there's an error to read, or the user is actively writing a note.
  useEffect(() => {
    if (error || addingNote) return
    const timer = setTimeout(() => router.push('/capture'), AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [error, addingNote, router])

  async function saveNote(): Promise<void> {
    if (!id) return
    try {
      await fetch(`/api/v1/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      })
    } finally {
      setNoteSaved(true)
      setAddingNote(false)
    }
  }

  if (error) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 py-8 text-center">
        <TriangleAlert className="size-12 text-destructive" aria-hidden="true" />
        <p className="text-base text-foreground">
          {ERROR_MESSAGES[error] ?? 'Something went wrong.'}
        </p>
        <Button onClick={() => router.push('/capture')}>Go to Capture</Button>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 py-8 text-center">
      <CircleCheck className="size-12 text-success" aria-hidden="true" />

      <div className="space-y-1">
        <p className="text-lg font-semibold text-foreground">
          {duplicate ? 'Already in Sieve' : 'Saved to Sieve'}
        </p>
        {item && (
          <div className="flex items-center justify-center gap-2">
            <KindBadge kind={item.kind} />
            <StatusPill status={item.status} />
          </div>
        )}
        {item?.title && (
          <p className="max-w-xs truncate text-sm text-muted-foreground">{item.title}</p>
        )}
      </div>

      {item && (
        <ExtractionTierWarning
          tier={item.extraction_tier}
          variant="detailed"
          className="w-full text-left"
        />
      )}

      {addingNote ? (
        <div className="w-full space-y-2 text-left">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Add a note…"
            rows={3}
            autoFocus
          />
          <Button onClick={() => void saveNote()} className="w-full">
            Save note
          </Button>
        </div>
      ) : (
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => setAddingNote(true)} className="flex-1">
            {noteSaved ? 'Edit note' : 'Add a note'}
          </Button>
          <Button onClick={() => router.push('/capture')} className="flex-1">
            Done
          </Button>
        </div>
      )}
    </main>
  )
}

'use client'

/**
 * The web paste box (docs/API.md-adjacent plan 8.6/8.7): paste one or many newline-separated
 * URLs, each becomes its own queued item, and each row polls its own live pipeline progress.
 *
 * Reuses P5's design system (`ItemCard`, `Button`, `Textarea`, `EmptyState`) rather than
 * inventing new primitives, per this phase's brief. `ItemCard` expects the exact `ItemSummary`
 * shape docs/API.md defines — this page's `/api/v1/items/:id` responses satisfy that structurally
 * (same field names/types), so no adapter layer is needed between "what the API returns" and
 * "what the card renders."
 */

import { useEffect, useRef, useState } from 'react'
import { Link2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/common/empty-state'
import { ItemCard } from '@/components/common/item-card'
import type { ItemWire } from '@/services/wire-types'

interface CaptureAck {
  id: string
  status: string
  duplicate: boolean
}

interface ApiErrorBody {
  error: { code: string; message: string; details: unknown; request_id: string }
}

type RowState =
  | { kind: 'pending'; url: string }
  | { kind: 'error'; url: string; message: string }
  | { kind: 'tracking'; url: string; id: string; duplicate: boolean; item: ItemWire | null }

const POLL_INTERVAL_MS = 2_500
// ~2 minutes of polling per batch — generous against P7's own "60s to Inbox" milestone, then
// stop hammering the server; whatever was last fetched stays on screen.
const MAX_POLL_TICKS = 48

const TERMINAL_STATUSES = new Set([
  'inbox',
  'to_test',
  'testing',
  'tested',
  'archived',
  'dropped',
  'failed',
])

function splitUrls(raw: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    const url = line.trim()
    if (url.length === 0 || seen.has(url)) continue
    seen.add(url)
    result.push(url)
  }
  return result
}

function looksLikeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * A friendly progress label derived entirely from already-documented `Item` fields
 * (docs/API.md §2) — never a fabricated pipeline-stage field the HTTP contract doesn't actually
 * expose. See this phase's final report on why the plan's literal "extracting -> enriching"
 * wording can't be backed by a real field without inventing new API surface.
 */
function describeProgress(item: ItemWire | null): string {
  if (!item) return 'Saving…'
  if (item.status === 'queued') return 'Queued'
  if (item.status === 'failed') return item.failure_reason ?? 'Failed'
  if (item.status === 'processing') {
    if (!item.content_text) return 'Extracting…'
    if (!item.summary_tldr) return 'Enriching…'
    return 'Finishing up…'
  }
  return 'Ready'
}

async function postCapture(url: string): Promise<CaptureAck> {
  const response = await fetch('/api/v1/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, surface: 'web' }),
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? (body as ApiErrorBody).error.message
        : 'Something went wrong. Try again.'
    throw new Error(message)
  }
  return body as CaptureAck
}

async function fetchItem(id: string): Promise<ItemWire | null> {
  const response = await fetch(`/api/v1/items/${id}`, { headers: { Accept: 'application/json' } })
  if (!response.ok) return null
  return (await response.json()) as ItemWire
}

export default function CapturePastePage() {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<RowState[]>([])
  const [submitting, setSubmitting] = useState(false)
  const tickCount = useRef(0)

  useEffect(() => {
    const pendingIds = rows
      .filter((row): row is Extract<RowState, { kind: 'tracking' }> => row.kind === 'tracking')
      .filter((row) => !row.item || !TERMINAL_STATUSES.has(row.item.status))
      .map((row) => row.id)

    if (pendingIds.length === 0) return
    if (tickCount.current >= MAX_POLL_TICKS) return

    const timer = setTimeout(() => {
      tickCount.current += 1
      void Promise.all(pendingIds.map(async (id) => ({ id, item: await fetchItem(id) }))).then(
        (results) => {
          setRows((current) =>
            current.map((row) => {
              if (row.kind !== 'tracking') return row
              const match = results.find((result) => result.id === row.id)
              return match ? { ...row, item: match.item ?? row.item } : row
            }),
          )
        },
      )
    }, POLL_INTERVAL_MS)

    return () => clearTimeout(timer)
  }, [rows])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const urls = splitUrls(text)
    if (urls.length === 0) return

    setSubmitting(true)
    tickCount.current = 0
    const initialRows: RowState[] = urls.map((url) =>
      looksLikeHttpUrl(url)
        ? { kind: 'pending', url }
        : { kind: 'error', url, message: 'Not a valid http(s) URL.' },
    )
    setRows((current) => [...initialRows, ...current])
    setText('')

    await Promise.all(
      initialRows.map(async (row, index) => {
        if (row.kind !== 'pending') return
        try {
          const ack = await postCapture(row.url)
          setRows((current) => {
            const next = [...current]
            next[index] = {
              kind: 'tracking',
              url: row.url,
              id: ack.id,
              duplicate: ack.duplicate,
              item: null,
            }
            return next
          })
        } catch (err) {
          setRows((current) => {
            const next = [...current]
            next[index] = {
              kind: 'error',
              url: row.url,
              message: err instanceof Error ? err.message : 'Something went wrong. Try again.',
            }
            return next
          })
        }
      }),
    )
    setSubmitting(false)
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Capture links</h1>
        <p className="text-sm text-muted-foreground">
          Paste one or more URLs, one per line. Each becomes its own item in your library.
        </p>
      </div>

      <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={'https://example.com/a-great-article\nhttps://youtube.com/watch?v=...'}
          rows={6}
          aria-label="URLs to save, one per line"
        />
        <Button
          type="submit"
          disabled={submitting || splitUrls(text).length === 0}
          className="w-full sm:w-auto"
        >
          {submitting ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" /> Saving…
            </>
          ) : (
            'Save links'
          )}
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={Link2}
          title="Nothing captured yet"
          description="Paste a link above to add it to your library."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rows.map((row, index) => {
            if (row.kind === 'pending') {
              return (
                <div
                  key={`${row.url}-${index}`}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground"
                >
                  <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
                  <span className="truncate">{row.url}</span>
                </div>
              )
            }
            if (row.kind === 'error') {
              return (
                <div
                  key={`${row.url}-${index}`}
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
                >
                  <p className="truncate font-medium text-destructive">{row.url}</p>
                  <p className="text-muted-foreground">{row.message}</p>
                </div>
              )
            }
            if (!row.item) {
              return (
                <div
                  key={row.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground"
                >
                  <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
                  <span className="truncate">{row.url}</span>
                </div>
              )
            }
            return (
              <div key={row.id} className="space-y-1">
                <ItemCard item={row.item} />
                <p className="px-1 text-xs text-muted-foreground">
                  {describeProgress(row.item)}
                  {row.duplicate ? ' · already in your library' : ''}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}

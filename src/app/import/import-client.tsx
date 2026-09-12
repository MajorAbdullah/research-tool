'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Upload } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'

interface StatusView {
  id: string
  state: 'previewed' | 'running' | 'paused' | 'completed' | 'failed'
  totalLinks: number
  duplicateCount: number
  byKind: Record<string, number>
  queued: number
  done: number
  failed: number
  etaHuman: string | null
  error: string | null
}

/**
 * Dry-run first, always.
 *
 * Uploading parses and persists a preview but writes nothing to the library; committing is a
 * second, explicit action. That ordering exists because the thing being imported is a pile the
 * user has been accumulating for months — "it imported 3 of 800 links" or "it imported 800
 * duplicates" are both unrecoverable-feeling outcomes, and a preview makes them visible before
 * anything is written.
 */
export function ImportClient() {
  const [status, setStatus] = useState<StatusView | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  const post = useCallback(
    async (body: FormData | object, isForm: boolean) => {
      setBusy(true)
      try {
        const res = await fetch('/api/v1/import', {
          method: 'POST',
          ...(isForm
            ? { body: body as FormData }
            : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        })
        const json: unknown = await res.json()
        if (!res.ok) {
          // NOTE: `'error' in json` cannot discriminate these two shapes — StatusView has its
          // own `error: string | null` field, and the API envelope has `error: { message }`.
          // Narrow on the nested object instead.
          const envelope = json as { error?: { message?: string } }
          toast({
            title: 'Import failed',
            description: envelope.error?.message ?? 'Unexpected error.',
            variant: 'destructive',
          })
          return
        }
        setStatus(json as StatusView)
      } finally {
        setBusy(false)
      }
    },
    [toast],
  )

  const upload = useCallback(
    (file: File) => {
      const form = new FormData()
      form.set('file', file)
      form.set('mode', 'dry_run')
      void post(form, true)
    },
    [post],
  )

  // Poll while an import is actively draining. A backlog runs for hours against the daily
  // budget, so the page has to stay informative without being refreshed.
  useEffect(() => {
    if (!status || status.state !== 'running') return
    const id = setInterval(() => {
      void fetch(`/api/v1/import/${status.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j && setStatus(j as StatusView))
    }, 4000)
    return () => clearInterval(id)
  }, [status])

  const kinds = status ? Object.entries(status.byKind).filter(([, n]) => n > 0) : []
  const willImport = status ? status.totalLinks - status.duplicateCount : 0

  return (
    <div className="grid gap-4">
      {!status ? (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const f = e.dataTransfer.files[0]
            if (f) upload(f)
          }}
          className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
            dragging ? 'border-primary bg-primary/5' : 'border-border'
          }`}
        >
          <Upload className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-sm font-medium text-foreground">Drop your WhatsApp export here</p>
          <p className="mt-1 text-xs text-muted-foreground">
            A <code className="text-xs">_chat.txt</code> or the whole{' '}
            <code className="text-xs">.zip</code> — up to 50 MB. Nothing is imported until you
            confirm.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept=".txt,.zip,text/plain,application/zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) upload(f)
            }}
          />
          <Button
            className="mt-4 min-h-11"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
          >
            {busy ? 'Reading…' : 'Choose file'}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              {status.state === 'previewed' ? 'Preview' : `Import ${status.state}`}
            </h2>
            <code className="text-xs text-muted-foreground">{status.id}</code>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Links found</dt>
              <dd className="text-xl font-semibold text-foreground">{status.totalLinks}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Already saved</dt>
              <dd className="text-xl font-semibold text-foreground">{status.duplicateCount}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Will import</dt>
              <dd className="text-xl font-semibold text-foreground">{willImport}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {status.state === 'running' ? 'Remaining' : 'Est. time'}
              </dt>
              <dd className="text-xl font-semibold text-foreground">{status.etaHuman ?? '—'}</dd>
            </div>
          </dl>

          {kinds.length ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {kinds.map(([k, n]) => (
                <span
                  key={k}
                  className="rounded-md border border-border px-2 py-0.5 text-xs text-foreground"
                >
                  {k} {n}
                </span>
              ))}
            </div>
          ) : null}

          {status.state === 'running' || status.state === 'paused' ? (
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${status.totalLinks ? Math.round((status.done / status.totalLinks) * 100) : 0}%`,
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {status.done} done · {status.queued} queued
                {status.failed > 0 ? ` · ${status.failed} failed` : ''}
              </p>
            </div>
          ) : null}

          {status.error ? (
            <p className="mt-4 flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {status.error}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {status.state === 'previewed' ? (
              <Button
                className="min-h-11"
                disabled={busy || willImport === 0}
                onClick={() => void post({ import_id: status.id, action: 'commit' }, false)}
              >
                Import {willImport} link{willImport === 1 ? '' : 's'}
              </Button>
            ) : null}
            {status.state === 'running' ? (
              <Button
                variant="outline"
                className="min-h-11"
                disabled={busy}
                onClick={() => void post({ import_id: status.id, action: 'pause' }, false)}
              >
                Pause
              </Button>
            ) : null}
            {status.state === 'paused' ? (
              <Button
                className="min-h-11"
                disabled={busy}
                onClick={() => void post({ import_id: status.id, action: 'resume' }, false)}
              >
                Resume
              </Button>
            ) : null}
            <Button variant="ghost" className="min-h-11" onClick={() => setStatus(null)}>
              {status.state === 'completed' ? 'Import another' : 'Start over'}
            </Button>
          </div>

          {status.state === 'previewed' && willImport > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Links are released gradually to stay inside the daily AI budget, so a large backlog
              drains over hours and picks up again automatically after the reset. You can close this
              page.
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}

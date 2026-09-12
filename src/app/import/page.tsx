import { requireSessionUserId } from '@/services/auth-context'

import { ImportClient } from './import-client'

export const metadata = { title: 'Import · Sieve' }
export const dynamic = 'force-dynamic'

export default async function ImportPage() {
  await requireSessionUserId()

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold text-foreground">Import from WhatsApp</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Drain the pile you have been sending to yourself. Each link keeps its{' '}
        <strong className="font-medium text-foreground">original share date</strong>, not
        today&rsquo;s — the point is recovering the history, not flattening it.
      </p>

      <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
        <h2 className="text-sm font-semibold text-foreground">Getting the export</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Open the chat in WhatsApp (your own &ldquo;message yourself&rdquo; chat works).</li>
          <li>
            Menu &rarr; <strong className="font-medium text-foreground">More</strong> &rarr;{' '}
            <strong className="font-medium text-foreground">Export chat</strong>.
          </li>
          <li>
            Choose <strong className="font-medium text-foreground">Without media</strong> — media is
            ignored and only makes the file large.
          </li>
          <li>Drop the resulting file below.</li>
        </ol>
      </div>

      <div className="mt-6">
        <ImportClient />
      </div>
    </div>
  )
}

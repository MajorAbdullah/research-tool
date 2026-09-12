'use client'

import { useEffect } from 'react'
import { TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/common/error-state'

/**
 * Next's route-level error boundary (must be a Client Component — Next.js file convention) for
 * anything that throws during `/library`'s server render itself (as opposed to a data-fetch
 * failure inside `page.tsx`, which is already caught there and degrades to a client-side retry —
 * see that file's comment). This is the last-resort net, not the primary error path.
 */
export default function LibraryError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Last-resort boundary; server-side errors are already logged with full detail where they
    // occur (page.tsx). This is a client-side visibility aid.
    console.error(error)
  }, [error])

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <ErrorState
        title="Couldn't load your library"
        description="Something went wrong loading this page. Your data is fine — try again."
        action={
          <Button size="sm" variant="outline" onClick={reset}>
            <TriangleAlert className="size-4" aria-hidden="true" />
            Try again
          </Button>
        }
      />
    </div>
  )
}

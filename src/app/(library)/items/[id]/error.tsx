'use client'

import { useEffect } from 'react'
import { TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/common/error-state'

/** Next's route-level error boundary (must be a Client Component) for anything that throws while rendering `/items/:id` outside the NOT_FOUND path already handled in `page.tsx`. */
export default function ItemDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <ErrorState
        title="Couldn't load this item"
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

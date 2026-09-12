import { LoadingGrid } from '@/components/common/loading-grid'

/** Next's automatic Suspense fallback while `page.tsx`'s server-side data fetch is in flight. */
export default function LibraryLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6">
      <div className="h-8 w-32 animate-pulse rounded-md bg-muted" aria-hidden="true" />
      <div className="h-11 w-full animate-pulse rounded-md bg-muted" aria-hidden="true" />
      <LoadingGrid count={8} />
    </div>
  )
}

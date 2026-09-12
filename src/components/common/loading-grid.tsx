import { Skeleton } from '@/components/ui/skeleton'

function ItemCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <Skeleton className="aspect-video w-full" />
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-14" />
      </div>
      <Skeleton className="h-4 w-4/5" />
      <div className="space-y-1.5">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-3/4" />
      </div>
      <div className="flex gap-1.5">
        <Skeleton className="h-5 w-14" />
        <Skeleton className="h-5 w-10" />
      </div>
    </div>
  )
}

export interface LoadingGridProps {
  count?: number
  className?: string
}

/**
 * The grid-shaped loading state for the library/search views. Built entirely
 * from Skeleton, so the app's one signature motion moment (the shimmer —
 * see globals.css) shows up here automatically rather than this component
 * inventing its own loading treatment.
 */
export function LoadingGrid({ count = 6 }: LoadingGridProps) {
  return (
    <div
      role="status"
      aria-label="Loading items"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {Array.from({ length: count }, (_, i) => (
        <ItemCardSkeleton key={i} />
      ))}
    </div>
  )
}

import type { ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface ErrorStateProps {
  /** Plain-language explanation of what happened — never a stack trace or error code. */
  title?: string
  description?: string
  /** Usually a <Button onClick={retry}>Try again</Button>. */
  action?: ReactNode
  className?: string
}

/**
 * Distinct from EmptyState (same overall shape, different tone and intent):
 * empty means "nothing here yet, here's what to do next"; this means
 * "something went wrong, here's what happened and how to retry." Kept as
 * its own component rather than an EmptyState variant because the two
 * genuinely differ in tone (warning vs neutral) and default content.
 */
export function ErrorState({
  title = 'Something went wrong',
  description = "That didn't load. Your data is fine — try again in a moment.",
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-10 text-center',
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
        <TriangleAlert className="size-6 text-destructive" aria-hidden="true" />
      </div>
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}

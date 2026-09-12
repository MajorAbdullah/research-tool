import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  /** Usually a <Button>; the guiding next action per ui-ux-best-practices.md §11. */
  action?: ReactNode
  className?: string
}

/**
 * One flexible component for every "nothing to show" screen — a genuinely
 * empty library, a search with no matches, an empty board column — rather
 * than a separate bespoke component per surface. Each call site supplies its
 * own icon/copy/action (see the gallery for the empty-library vs
 * no-search-results usages), which is enough variation without duplicating
 * the layout three times.
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-10 text-center', className)}>
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

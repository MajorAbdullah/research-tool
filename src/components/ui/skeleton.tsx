import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

/**
 * Loading placeholder. Carries the app's one signature motion moment (the
 * `.shimmer` sweep defined in globals.css) — see the long comment there for
 * why this is the single place motion budget was spent. Every other loading
 * indicator in the system (LoadingGrid, ItemCard's processing state) is
 * built from this one component so the moment only has one implementation.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="presentation"
      aria-hidden="true"
      className={cn('shimmer rounded-md bg-muted', className)}
      {...props}
    />
  )
}

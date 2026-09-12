import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'
import { cva, type VariantPropsOf } from '@/components/ui/variants'

/**
 * Generic display chip — the base that KindBadge/StatusPill/TopicChip in
 * `components/common` style on top of. Badges are informational, not
 * interactive, so the 44x44 touch-target rule doesn't apply to them (that
 * rule governs things you tap, not things you read); if a future phase makes
 * one clickable (e.g. a topic filter), it belongs wrapped in a real
 * `<button>`, not turned into one here.
 */
export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border bg-transparent text-foreground',
        muted: 'border-transparent bg-muted text-muted-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        warning: 'border-transparent bg-warning text-warning-foreground',
        success: 'border-transparent bg-success text-success-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

type BadgeVariantProps = VariantPropsOf<typeof badgeVariants>

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, BadgeVariantProps {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />
}

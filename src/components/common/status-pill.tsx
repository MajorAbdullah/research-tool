import {
  Archive,
  Circle,
  CircleCheckBig,
  Clock,
  FlaskConical,
  Inbox,
  LoaderCircle,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import type { ItemStatus } from '@/components/common/types'

/**
 * Nine statuses is too many to give nine hues without turning the palette
 * into confetti (ui-ux-best-practices.md's "small, deliberate palette"), so
 * they're bucketed into the system's five semantic tones by what they mean
 * to a researcher deciding what to look at next — pipeline-owned/transient
 * (neutral), needs attention (primary), in progress (warning), a good
 * outcome (success), a real problem (destructive) — with `dropped` kept
 * neutral rather than destructive on purpose: dropping something is a valid
 * research outcome, not an error, and conflating the two would make
 * "failed" less alarming when it matters.
 */
const STATUS_CONFIG: Record<ItemStatus, { label: string; icon: LucideIcon; className: string; spin?: boolean }> = {
  queued: { label: 'Queued', icon: Clock, className: 'bg-muted text-muted-foreground' },
  processing: { label: 'Processing', icon: LoaderCircle, className: 'bg-muted text-muted-foreground', spin: true },
  inbox: { label: 'Inbox', icon: Inbox, className: 'bg-primary/10 text-primary' },
  to_test: { label: 'To test', icon: Circle, className: 'bg-secondary text-secondary-foreground' },
  testing: { label: 'Testing', icon: FlaskConical, className: 'bg-warning/15 text-warning' },
  tested: { label: 'Tested', icon: CircleCheckBig, className: 'bg-success/15 text-success' },
  archived: { label: 'Archived', icon: Archive, className: 'bg-muted text-muted-foreground' },
  dropped: { label: 'Dropped', icon: X, className: 'bg-muted text-muted-foreground' },
  failed: { label: 'Failed', icon: TriangleAlert, className: 'bg-destructive/10 text-destructive' },
}

export interface StatusPillProps {
  status: ItemStatus
  className?: string
}

/** Research status — the second thing the user must be able to tell at a glance. */
export function StatusPill({ status, className }: StatusPillProps) {
  const { label, icon: Icon, className: toneClassName, spin } = STATUS_CONFIG[status]
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
        toneClassName,
        className
      )}
    >
      <Icon className={cn('size-3.5', spin && 'animate-spin')} aria-hidden="true" />
      {label}
    </span>
  )
}

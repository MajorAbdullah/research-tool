import type { ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { ExtractionTier } from '@/components/common/types'

const TIER_COPY: Record<Exclude<ExtractionTier, 'full'>, { label: string; detail: string }> = {
  partial: {
    label: 'Partial extraction',
    detail: 'Some content came through, but not the full source — re-opening with the extension can fill in the rest.',
  },
  metadata_only: {
    label: 'Metadata only',
    detail: 'Only the title and thumbnail were captured. Open the original with the browser extension to enrich it.',
  },
}

export interface ExtractionTierWarningProps {
  tier: ExtractionTier
  /** `compact` (default) for a card footer; `detailed` for an item-detail-style banner. */
  variant?: 'compact' | 'detailed'
  /** Slot for a real "Re-extract" action — this component doesn't wire the API call itself. */
  action?: ReactNode
  className?: string
}

/**
 * Renders nothing when `tier === 'full'` — that's the point. CLAUDE.md is
 * explicit that silent degradation is the exact failure this product exists
 * to prevent, so this warning is never optional chrome: everywhere an item
 * is shown, this component (or its absence) is the tell for whether what
 * you're looking at is the whole story.
 */
export function ExtractionTierWarning({ tier, variant = 'compact', action, className }: ExtractionTierWarningProps) {
  if (tier === 'full') return null
  const { label, detail } = TIER_COPY[tier]

  if (variant === 'compact') {
    return (
      <span
        className={cn(
          'inline-flex w-fit items-center gap-1 rounded-md bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning',
          className
        )}
        title={detail}
      >
        <TriangleAlert className="size-3.5" aria-hidden="true" />
        {label}
      </span>
    )
  }

  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4 text-warning',
        className
      )}
    >
      <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-foreground">
        <p className="text-sm font-medium text-warning">{label}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  )
}

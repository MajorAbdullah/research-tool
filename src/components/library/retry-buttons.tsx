'use client'

import { RefreshCw, Sparkles } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { RetryStage } from '@/components/library/api-client'

export interface RetryButtonsProps {
  onRetry: (stage: RetryStage) => void
  isRetrying: boolean
  retryingStage?: RetryStage
}

/**
 * Deliverable #11 — "this is how a `metadata_only` item gets upgraded after installing the
 * extension". Both buttons stay enabled regardless of `extraction_tier`/status — re-enriching an
 * already-`full` item to regenerate a stale summary is a legitimate action too, not just a
 * degraded-item recovery path.
 */
export function RetryButtons({ onRetry, isRetrying, retryingStage }: RetryButtonsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onRetry('extract')}
        disabled={isRetrying}
      >
        <RefreshCw
          className={cn('size-4', isRetrying && retryingStage === 'extract' && 'animate-spin')}
          aria-hidden="true"
        />
        Re-extract
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onRetry('enrich')}
        disabled={isRetrying}
      >
        <Sparkles
          className={cn('size-4', isRetrying && retryingStage === 'enrich' && 'animate-spin')}
          aria-hidden="true"
        />
        Re-enrich
      </Button>
    </div>
  )
}

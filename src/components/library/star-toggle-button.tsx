'use client'

import { Star } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export interface StarToggleButtonProps {
  starred: boolean
  onToggle: () => void
  isSaving: boolean
}

/** The other half of "editable ... star" (deliverable #10) — optimistic via the shared patch mutation in use-item-detail.ts. */
export function StarToggleButton({ starred, onToggle, isSaving }: StarToggleButtonProps) {
  return (
    <Button
      type="button"
      variant={starred ? 'default' : 'outline'}
      onClick={onToggle}
      disabled={isSaving}
      aria-pressed={starred}
    >
      <Star className={cn('size-4', starred && 'fill-current')} aria-hidden="true" />
      {starred ? 'Starred' : 'Star'}
    </Button>
  )
}

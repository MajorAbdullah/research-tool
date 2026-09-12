'use client'

import { X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatDate } from '@/components/library/format'
import type { LibraryFilters } from '@/components/library/types'
import type { TopicFacet } from '@/components/library/use-filter-facets'

interface Chip {
  key: string
  label: string
  remove: () => void
}

function removeFrom<T>(list: readonly T[], value: T): T[] {
  return list.filter((v) => v !== value)
}

const KIND_LABELS: Record<string, string> = {
  github: 'Repo',
  video: 'Video',
  article: 'Article',
  social: 'Social',
  pdf: 'PDF',
  audio: 'Audio',
  other: 'Link',
}
const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  processing: 'Processing',
  inbox: 'Inbox',
  to_test: 'To test',
  testing: 'Testing',
  tested: 'Tested',
  archived: 'Archived',
  dropped: 'Dropped',
  failed: 'Failed',
}
const TIER_LABELS: Record<string, string> = {
  full: 'Full',
  partial: 'Partial',
  metadata_only: 'Metadata only',
}

function buildChips(
  filters: LibraryFilters,
  topics: TopicFacet[],
  onChange: (next: LibraryFilters) => void,
): Chip[] {
  const topicLabel = new Map(topics.map((t) => [t.slug, t.label]))
  const chips: Chip[] = []

  for (const kind of filters.kind) {
    chips.push({
      key: `kind:${kind}`,
      label: KIND_LABELS[kind] ?? kind,
      remove: () => onChange({ ...filters, kind: removeFrom(filters.kind, kind) }),
    })
  }
  for (const status of filters.status) {
    chips.push({
      key: `status:${status}`,
      label: STATUS_LABELS[status] ?? status,
      remove: () => onChange({ ...filters, status: removeFrom(filters.status, status) }),
    })
  }
  for (const tier of filters.extractionTier) {
    chips.push({
      key: `tier:${tier}`,
      label: TIER_LABELS[tier] ?? tier,
      remove: () =>
        onChange({ ...filters, extractionTier: removeFrom(filters.extractionTier, tier) }),
    })
  }
  for (const slug of filters.topic) {
    chips.push({
      key: `topic:${slug}`,
      label: topicLabel.get(slug) ?? slug,
      remove: () => onChange({ ...filters, topic: removeFrom(filters.topic, slug) }),
    })
  }
  for (const tag of filters.tag) {
    chips.push({
      key: `tag:${tag}`,
      label: `#${tag}`,
      remove: () => onChange({ ...filters, tag: removeFrom(filters.tag, tag) }),
    })
  }
  if (filters.dateFrom !== undefined || filters.dateTo !== undefined) {
    const from = filters.dateFrom !== undefined ? formatDate(filters.dateFrom) : '…'
    const to = filters.dateTo !== undefined ? formatDate(filters.dateTo) : '…'
    chips.push({
      key: 'date-range',
      label: `${from} – ${to}`,
      remove: () => onChange({ ...filters, dateFrom: undefined, dateTo: undefined }),
    })
  }

  return chips
}

export interface ActiveFilterChipsProps {
  filters: LibraryFilters
  topics: TopicFacet[]
  onChange: (next: LibraryFilters) => void
  className?: string
}

/**
 * "Recognition over recall" (ui-ux-best-practices.md): once the filter sheet is closed, the only
 * way to remember what's currently narrowing the grid would be to reopen it — these chips keep
 * every active filter visible and individually removable without leaving the page.
 */
export function ActiveFilterChips({
  filters,
  topics,
  onChange,
  className,
}: ActiveFilterChipsProps) {
  const chips = buildChips(filters, topics, onChange)
  if (chips.length === 0) return null

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} aria-label="Active filters">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.remove}
          className={cn(
            'inline-flex h-11 items-center gap-1.5 rounded-md bg-muted pr-3 pl-3 text-xs font-medium text-muted-foreground',
            'outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          {chip.label}
          <X className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Remove filter: {chip.label}</span>
        </button>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          onClick={() =>
            onChange({
              kind: [],
              topic: [],
              tag: [],
              status: [],
              extractionTier: [],
              dateFrom: undefined,
              dateTo: undefined,
            })
          }
          className="inline-flex h-11 items-center rounded-md px-3 text-xs font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Clear all
        </button>
      )}
    </div>
  )
}

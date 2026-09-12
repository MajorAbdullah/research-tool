'use client'

/**
 * Board filters (plan §10, P11.5): kind + topic, combined with AND, applied board-wide (so
 * setting kind=github and looking at the To Test column is literally "only repos in To Test" —
 * the filter narrows every column at once, not one column independently of the rest).
 */

import { Filter, RotateCcw } from 'lucide-react'

import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { ALL_ITEM_KINDS, KIND_LABELS, type BoardFilters } from './board-types'
import { hasActiveFilters, type TopicOption } from './board-filters'

export interface BoardToolbarProps {
  filters: BoardFilters
  onChange: (filters: BoardFilters) => void
  topics: TopicOption[]
}

export function BoardToolbar({ filters, onChange, topics }: BoardToolbarProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex items-center gap-1.5 pb-2.5 text-sm font-medium text-muted-foreground">
        <Filter className="size-4" aria-hidden="true" />
        Filter
      </div>

      <div className="min-w-36 space-y-1">
        <Label htmlFor="board-filter-kind" className="text-xs text-muted-foreground">
          Kind
        </Label>
        <Select
          id="board-filter-kind"
          value={filters.kind ?? ''}
          onChange={(event) =>
            onChange({
              ...filters,
              kind: event.target.value === '' ? null : (event.target.value as BoardFilters['kind']),
            })
          }
        >
          <option value="">All kinds</option>
          {ALL_ITEM_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          ))}
        </Select>
      </div>

      <div className="min-w-40 space-y-1">
        <Label htmlFor="board-filter-topic" className="text-xs text-muted-foreground">
          Topic
        </Label>
        <Select
          id="board-filter-topic"
          value={filters.topic ?? ''}
          onChange={(event) =>
            onChange({ ...filters, topic: event.target.value === '' ? null : event.target.value })
          }
        >
          <option value="">All topics</option>
          {topics.map((topic) => (
            <option key={topic.slug} value={topic.slug}>
              {topic.label}
            </option>
          ))}
        </Select>
      </div>

      {hasActiveFilters(filters) && (
        <Button variant="ghost" size="sm" onClick={() => onChange({ kind: null, topic: null })}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Reset
        </Button>
      )}
    </div>
  )
}

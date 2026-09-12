import { Filter } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import type { ItemKind } from '@/types/contracts'
import type { ChatScope } from './use-chat-session'

const KIND_OPTIONS: { value: ItemKind; label: string }[] = [
  { value: 'github', label: 'Repos' },
  { value: 'video', label: 'Videos' },
  { value: 'article', label: 'Articles' },
  { value: 'social', label: 'Social posts' },
  { value: 'pdf', label: 'PDFs' },
  { value: 'audio', label: 'Audio' },
  { value: 'other', label: 'Other links' },
]

export interface ScopeFilterProps {
  scope: ChatScope
  onChange: (scope: ChatScope) => void
  disabled?: boolean
}

/**
 * "Only search my repos" (P13.6): narrows retrieval to one item kind and/or one topic slug.
 * Applied to every message sent while set — a visible, sticky scope, not a one-shot query
 * modifier, so the user always knows what the assistant is currently limited to.
 *
 * Every control here keeps the design system's default `h-11` (44px) height — this row sits
 * directly above the composer and is just as tappable on Android as the send button itself, so
 * it gets no exemption from the 44×44pt touch-target floor.
 */
export function ScopeFilter({ scope, onChange, disabled }: ScopeFilterProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Filter className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <Select
        aria-label="Only search this kind of item"
        className="w-auto min-w-32"
        value={scope.kind ?? ''}
        disabled={disabled}
        onChange={(event) => {
          const value = event.target.value
          onChange({ ...scope, kind: value === '' ? undefined : (value as ItemKind) })
        }}
      >
        <option value="">All kinds</option>
        {KIND_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <Input
        aria-label="Only search this topic"
        placeholder="Topic (optional)"
        className="w-36"
        value={scope.topic ?? ''}
        disabled={disabled}
        onChange={(event) => onChange({ ...scope, topic: event.target.value || undefined })}
      />
      {(scope.kind ?? scope.topic) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => onChange({})}
        >
          Clear
        </Button>
      )}
    </div>
  )
}

'use client'

import { useId, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { KindBadge } from '@/components/common/kind-badge'
import { StatusPill } from '@/components/common/status-pill'
import { dateInputValueToEpochMs, epochMsToDateInputValue } from '@/components/library/format'
import {
  EXTRACTION_TIER_VALUES,
  ITEM_KIND_VALUES,
  ITEM_STATUS_VALUES,
} from '@/components/library/query-params'
import type { TopicFacet } from '@/components/library/use-filter-facets'
import { EMPTY_FILTERS } from '@/components/library/types'
import type { LibraryFilters } from '@/components/library/types'

const TIER_LABELS: Record<(typeof EXTRACTION_TIER_VALUES)[number], string> = {
  full: 'Full',
  partial: 'Partial',
  metadata_only: 'Metadata only',
}

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

interface CheckboxRowProps {
  id: string
  checked: boolean
  onCheckedChange: () => void
  children: ReactNode
}

function CheckboxRow({ id, checked, onCheckedChange, children }: CheckboxRowProps) {
  return (
    <div className="flex min-h-11 items-center gap-2.5">
      <Checkbox id={id} checked={checked} onChange={onCheckedChange} />
      <Label htmlFor={id} className="flex-1 cursor-pointer py-2 font-normal">
        {children}
      </Label>
    </div>
  )
}

export interface FilterSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: LibraryFilters
  onApply: (next: LibraryFilters) => void
  topicOptions: TopicFacet[]
  tagOptions: string[]
}

/**
 * The filter rail (deliverable #3), built as one `Sheet` used identically at every width — a
 * bottom sheet on phones, a right-side panel from `sm:` up (native to `Sheet`, see its own file
 * comment) — rather than two separate interaction models for an inline desktop rail vs. a mobile
 * drawer. Edits are staged locally and committed via the footer's Apply (matching the Sheet
 * pattern the gallery itself demonstrates) so ten checkbox taps don't push ten separate URL
 * states onto history.
 */
export function FilterSheet({
  open,
  onOpenChange,
  filters,
  onApply,
  topicOptions,
  tagOptions,
}: FilterSheetProps) {
  const [draft, setDraft] = useState(filters)
  // Tracks the `open` value as of the last render so a transition to `open` can reset the draft
  // to the committed filters — done as a render-time state adjustment (React's documented
  // pattern for "resetting state when a prop changes"), not a `useEffect`, so reopening the sheet
  // never shows one stale frame of the previous draft before an effect corrects it.
  const [wasOpen, setWasOpen] = useState(open)
  const idBase = useId()

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setDraft(filters)
  }

  const dateFromValue = epochMsToDateInputValue(draft.dateFrom)
  const dateToValue = epochMsToDateInputValue(draft.dateTo)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-label="Filter library">
        <SheetHeader>
          <SheetTitle>Filter library</SheetTitle>
          <SheetDescription>
            Narrow the grid by kind, topic, tag, status, tier, or date.
          </SheetDescription>
        </SheetHeader>

        <div className="max-h-[60vh] space-y-6 overflow-y-auto pr-1">
          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-medium text-foreground">Kind</legend>
            {ITEM_KIND_VALUES.map((kind) => (
              <CheckboxRow
                key={kind}
                id={`${idBase}-kind-${kind}`}
                checked={draft.kind.includes(kind)}
                onCheckedChange={() => setDraft((d) => ({ ...d, kind: toggle(d.kind, kind) }))}
              >
                <KindBadge kind={kind} />
              </CheckboxRow>
            ))}
          </fieldset>

          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-medium text-foreground">Status</legend>
            {ITEM_STATUS_VALUES.map((status) => (
              <CheckboxRow
                key={status}
                id={`${idBase}-status-${status}`}
                checked={draft.status.includes(status)}
                onCheckedChange={() =>
                  setDraft((d) => ({ ...d, status: toggle(d.status, status) }))
                }
              >
                <StatusPill status={status} />
              </CheckboxRow>
            ))}
          </fieldset>

          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-medium text-foreground">Extraction tier</legend>
            {EXTRACTION_TIER_VALUES.map((tier) => (
              <CheckboxRow
                key={tier}
                id={`${idBase}-tier-${tier}`}
                checked={draft.extractionTier.includes(tier)}
                onCheckedChange={() =>
                  setDraft((d) => ({ ...d, extractionTier: toggle(d.extractionTier, tier) }))
                }
              >
                {TIER_LABELS[tier]}
              </CheckboxRow>
            ))}
          </fieldset>

          {topicOptions.length > 0 && (
            <fieldset className="space-y-1">
              <legend className="mb-1 text-sm font-medium text-foreground">Topic</legend>
              {topicOptions.map((topic) => (
                <CheckboxRow
                  key={topic.slug}
                  id={`${idBase}-topic-${topic.slug}`}
                  checked={draft.topic.includes(topic.slug)}
                  onCheckedChange={() =>
                    setDraft((d) => ({ ...d, topic: toggle(d.topic, topic.slug) }))
                  }
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: topic.color }}
                    />
                    {topic.label}
                  </span>
                </CheckboxRow>
              ))}
            </fieldset>
          )}

          {tagOptions.length > 0 && (
            <fieldset className="space-y-1">
              <legend className="mb-1 text-sm font-medium text-foreground">Tag</legend>
              {tagOptions.map((tag) => (
                <CheckboxRow
                  key={tag}
                  id={`${idBase}-tag-${tag}`}
                  checked={draft.tag.includes(tag)}
                  onCheckedChange={() => setDraft((d) => ({ ...d, tag: toggle(d.tag, tag) }))}
                >
                  {tag}
                </CheckboxRow>
              ))}
            </fieldset>
          )}

          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-foreground">Date added</legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-date-from`}>From</Label>
                <Input
                  id={`${idBase}-date-from`}
                  type="date"
                  value={dateFromValue}
                  max={dateToValue || undefined}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      dateFrom: dateInputValueToEpochMs(e.target.value, 'start'),
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${idBase}-date-to`}>To</Label>
                <Input
                  id={`${idBase}-date-to`}
                  type="date"
                  value={dateToValue}
                  min={dateFromValue || undefined}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      dateTo: dateInputValueToEpochMs(e.target.value, 'end'),
                    }))
                  }
                />
              </div>
            </div>
          </fieldset>
        </div>

        <SheetFooter>
          <Button
            variant="outline"
            onClick={() => {
              setDraft(EMPTY_FILTERS)
            }}
          >
            Reset
          </Button>
          <Button
            onClick={() => {
              onApply(draft)
              onOpenChange(false)
            }}
          >
            Apply
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

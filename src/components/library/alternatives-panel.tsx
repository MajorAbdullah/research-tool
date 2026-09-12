import { Shuffle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { KindBadge } from '@/components/common/kind-badge'
import { EmptyState } from '@/components/common/empty-state'
import type { ItemRelation, RelationType } from '@/components/library/types'

const RELATION_LABEL: Record<RelationType, string> = {
  alternative: 'Alternative',
  similar: 'Similar',
  supersedes: 'Supersedes',
}

export interface AlternativesPanelProps {
  relations: ItemRelation[]
}

/**
 * Deliverable #8 — "alternatives / competes with" panel. The live API (2026-09-12, seeded data)
 * returns relations with `rationale: ""` for every row the `relate` stage had actually produced —
 * see `library/types.ts`'s comment on `ItemRelation.rationale` — so the rationale line is only
 * rendered when non-empty, never as an empty "Why: " label. The task brief explicitly calls out
 * that the API "may return none yet" — handled below, not assumed away.
 */
export function AlternativesPanel({ relations }: AlternativesPanelProps) {
  if (relations.length === 0) {
    return (
      <EmptyState
        icon={Shuffle}
        title="No related items yet"
        description="Sieve looks for alternatives and similar saves automatically as your library grows."
      />
    )
  }

  return (
    <ul className="space-y-2">
      {relations.map((relation) => (
        <li key={relation.item_id}>
          <a
            href={`/items/${relation.item_id}`}
            className="flex flex-col gap-1 rounded-lg border border-border p-3 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <KindBadge kind={relation.kind} />
                <span className="truncate text-sm font-medium text-foreground">
                  {relation.title ?? 'Untitled'}
                </span>
              </span>
              <Badge variant="secondary" className="shrink-0">
                {RELATION_LABEL[relation.type]}
              </Badge>
            </div>
            {relation.rationale && (
              <p className="text-xs text-muted-foreground">{relation.rationale}</p>
            )}
          </a>
        </li>
      ))}
    </ul>
  )
}

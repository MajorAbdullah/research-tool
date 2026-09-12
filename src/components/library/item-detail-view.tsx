'use client'

import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'

import { KindBadge } from '@/components/common/kind-badge'
import { StatusPill } from '@/components/common/status-pill'
import { ExtractionTierWarning } from '@/components/common/extraction-tier-warning'
import { ErrorState } from '@/components/common/error-state'
import { Button } from '@/components/ui/button'
import { AlternativesPanel } from '@/components/library/alternatives-panel'
import { formatDate } from '@/components/library/format'
import { GithubRepoTable } from '@/components/library/github-repo-table'
import { NoteEditor } from '@/components/library/note-editor'
import { ReaderView } from '@/components/library/reader-view'
import { RetryButtons } from '@/components/library/retry-buttons'
import { StarToggleButton } from '@/components/library/star-toggle-button'
import { TagTopicEditor } from '@/components/library/tag-topic-editor'
import { useItemDetail } from '@/components/library/use-item-detail'
import type { ItemDetail } from '@/components/library/types'

export interface ItemDetailViewProps {
  itemId: string
  initialItem: ItemDetail
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold text-foreground">{children}</h2>
}

/**
 * Top-level client orchestrator for `/items/:id` (deliverables #6-11). Server Component
 * `page.tsx` fetches the item once and hands it here as `initialItem`; every edit/retry from this
 * point on goes through `useItemDetail`'s two mutations against the real, versioned HTTP API.
 */
export function ItemDetailView({ itemId, initialItem }: ItemDetailViewProps) {
  const { item, isError, refetch, patch, isPatching, retry, isRetrying, retryingStage } =
    useItemDetail(itemId, initialItem)

  if (isError && !item) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <ErrorState
          title="Couldn't load this item"
          description="Something went wrong. Your data is fine — try again."
          action={
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          }
        />
      </div>
    )
  }

  // TanStack Query is seeded with initialItem, so this is only reachable for one render before
  // the seed applies — kept for type-safety (queries can, in principle, have no data yet) rather
  // than asserting non-null.
  if (!item) return null

  const isGithub = item.kind === 'github' && item.kind_fields

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <a
        href="/library"
        className="mb-4 inline-flex h-11 items-center text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        ← Back to library
      </a>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <KindBadge kind={item.kind} />
          <StatusPill status={item.status} />
        </div>

        <h1 className="text-2xl font-semibold text-balance text-foreground">
          {item.title ?? 'Untitled'}
        </h1>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {item.author && <span>{item.author}</span>}
          <span>Saved {formatDate(item.created_at)}</span>
          {item.published_at && <span>Published {formatDate(item.published_at)}</span>}
          <a
            href={item.canonical_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open source
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StarToggleButton
            starred={item.starred}
            isSaving={isPatching}
            onToggle={() => patch({ starred: !item.starred })}
          />
          <RetryButtons onRetry={retry} isRetrying={isRetrying} retryingStage={retryingStage} />
        </div>
      </header>

      {/* Deliverable #6: the extraction tier prominently when it isn't `full` — with a direct
          Re-extract action right where the warning is, not just buried in the button row above. */}
      <ExtractionTierWarning
        tier={item.extraction_tier}
        variant="detailed"
        className="mt-6"
        action={
          item.extraction_tier !== 'full' ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => retry('extract')}
              disabled={isRetrying}
            >
              Re-extract now
            </Button>
          ) : undefined
        }
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          <section aria-labelledby="summary-heading">
            <SectionHeading>
              <span id="summary-heading">Summary</span>
            </SectionHeading>
            {item.summary_tldr ? (
              <p className="text-sm text-foreground">{item.summary_tldr}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">Not summarized yet.</p>
            )}
            {item.summary_bullets.length > 0 && (
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-foreground">
                {item.summary_bullets.map((bullet, i) => (
                  // Bullets are opaque LLM output with no stable id of their own; index is safe
                  // here because this list is never reordered/filtered independently of the item.
                  <li key={`${item.id}-bullet-${i}`}>{bullet}</li>
                ))}
              </ul>
            )}
          </section>

          {isGithub && item.kind_fields && (
            <section aria-labelledby="repo-heading">
              <SectionHeading>
                <span id="repo-heading">Repository</span>
              </SectionHeading>
              <GithubRepoTable fields={item.kind_fields} />
            </section>
          )}

          {item.content_text && (
            <section aria-labelledby="reader-heading">
              <h2 id="reader-heading" className="sr-only">
                Full content
              </h2>
              <ReaderView title="Read full content" content={item.content_text} />
            </section>
          )}

          <section aria-labelledby="alternatives-heading">
            <SectionHeading>
              <span id="alternatives-heading">Alternatives &amp; related</span>
            </SectionHeading>
            <AlternativesPanel relations={item.relations} />
          </section>
        </div>

        <div className="space-y-8">
          <section aria-labelledby="note-heading">
            <h2 id="note-heading" className="sr-only">
              Your note
            </h2>
            <NoteEditor note={item.note} isSaving={isPatching} onSave={(note) => patch({ note })} />
          </section>

          <section aria-labelledby="tags-heading">
            <h2 id="tags-heading" className="sr-only">
              Tags and topic
            </h2>
            <TagTopicEditor
              tags={item.tags}
              topic={item.topic}
              isSaving={isPatching}
              onSaveTags={(tags) => patch({ tags })}
              onSaveTopic={(topic) => patch({ topic })}
            />
          </section>

          {item.failure_reason && (
            <section aria-labelledby="failure-heading">
              <SectionHeading>
                <span id="failure-heading">Failure reason</span>
              </SectionHeading>
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {item.failure_reason}
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

import {
  AudioLines,
  FileText,
  FolderGit2,
  Globe,
  MessageCircle,
  Newspaper,
  Star,
  Video,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { KindBadge } from '@/components/common/kind-badge'
import { StatusPill } from '@/components/common/status-pill'
import { TopicChip } from '@/components/common/topic-chip'
import { ExtractionTierWarning } from '@/components/common/extraction-tier-warning'
import type { ItemKind, ItemSummary } from '@/components/common/types'

// See kind-badge.tsx: lucide-react has no brand-logo `Github` export in this
// version, so the fallback thumbnail icon uses the same conceptual stand-in.
const FALLBACK_ICON: Record<ItemKind, LucideIcon> = {
  github: FolderGit2,
  video: Video,
  article: Newspaper,
  social: MessageCircle,
  pdf: FileText,
  audio: AudioLines,
  other: Globe,
}

const MAX_VISIBLE_TAGS = 3

export interface ItemCardProps {
  item: ItemSummary
  /** When provided, the title becomes a link and the whole card is clickable (stretched-link pattern). */
  href?: string
  className?: string
}

/**
 * The unit of the library grid, board columns, and search results. Renders
 * every ItemKind from fixture data (see the gallery) and always shows: kind,
 * status, and — critically — the extraction tier the moment it's not
 * `full`. That last one is a product requirement, not a nice-to-have: see
 * CLAUDE.md, "Never let extraction failure look like success."
 */
export function ItemCard({ item, href, className }: ItemCardProps) {
  const FallbackIcon = FALLBACK_ICON[item.kind]
  const isWorking = item.status === 'queued' || item.status === 'processing'
  const visibleTags = item.tags.slice(0, MAX_VISIBLE_TAGS)
  const overflowCount = item.tags.length - visibleTags.length

  return (
    <article
      className={cn(
        'relative flex flex-col gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground',
        className,
      )}
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-muted">
        {item.thumbnail_url ? (
          // Thumbnails come from arbitrary remote hosts (github, youtube, instagram, any
          // blog). next/image needs an allowlisted remotePattern per domain, which cannot
          // be enumerated for user-supplied URLs, so a plain <img> is correct here.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnail_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <FallbackIcon className="size-8 text-muted-foreground" aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <KindBadge kind={item.kind} />
          {item.starred && (
            <span className="inline-flex items-center text-warning" title="Starred">
              <Star className="size-3.5 fill-current" aria-hidden="true" />
              <span className="sr-only">Starred</span>
            </span>
          )}
        </div>
        <StatusPill status={item.status} />
      </div>

      <h3 className="line-clamp-2 text-sm leading-snug font-semibold text-foreground">
        {href ? (
          // The stretched-link pattern: this <a> is the only interactive
          // descendant an assistive tech user encounters, but its ::after
          // overlay makes the entire <article> clickable for pointer users.
          <a href={href} className="static after:absolute after:inset-0">
            {item.title ?? 'Untitled'}
          </a>
        ) : (
          (item.title ?? 'Untitled')
        )}
      </h3>

      {isWorking ? (
        <div className="space-y-1.5" aria-label="Summary is still being generated">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      ) : item.summary_tldr ? (
        <p className="line-clamp-2 text-sm text-muted-foreground">{item.summary_tldr}</p>
      ) : (
        <p className="text-sm text-muted-foreground italic">Not summarized yet.</p>
      )}

      {(item.topic || visibleTags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {item.topic && <TopicChip label={item.topic.label} color={item.topic.color} />}
          {visibleTags.map((tag) => (
            <TopicChip key={tag} label={tag} />
          ))}
          {overflowCount > 0 && <TopicChip label={`+${overflowCount}`} />}
        </div>
      )}

      <ExtractionTierWarning tier={item.extraction_tier} />
    </article>
  )
}

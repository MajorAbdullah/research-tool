import {
  AudioLines,
  FileText,
  FolderGit2,
  Globe,
  MessageCircle,
  Newspaper,
  Video,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import type { ItemKind } from '@/components/common/types'

// lucide-react dropped the literal GitHub brand mark (trademark reasons —
// there is no `Github` export in this version); FolderGit2 is the closest
// non-brand icon that still reads unambiguously as "code repository."
const KIND_CONFIG: Record<ItemKind, { label: string; icon: LucideIcon }> = {
  github: { label: 'Repo', icon: FolderGit2 },
  video: { label: 'Video', icon: Video },
  article: { label: 'Article', icon: Newspaper },
  social: { label: 'Social', icon: MessageCircle },
  pdf: { label: 'PDF', icon: FileText },
  audio: { label: 'Audio', icon: AudioLines },
  other: { label: 'Link', icon: Globe },
}

export interface KindBadgeProps {
  kind: ItemKind
  className?: string
}

/**
 * What kind of thing is this — one of the three things the user must be
 * able to tell at a glance (see the project brief). Kind is communicated by
 * icon *and* label together, never the icon alone, and every kind shares the
 * same neutral chip styling: the icon carries the meaning, not a color, so
 * seven kinds don't turn into seven competing hues in a dense grid.
 */
export function KindBadge({ kind, className }: KindBadgeProps) {
  const { label, icon: Icon } = KIND_CONFIG[kind]
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1 rounded-md border border-transparent bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground',
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  )
}

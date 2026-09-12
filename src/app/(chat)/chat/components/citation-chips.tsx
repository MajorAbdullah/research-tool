import type { ChatSourceVM } from './use-chat-session'

/**
 * `/items/:id` — confirmed live against P10's own running dev server (`src/app/(library)/**`,
 * built in a sibling worktree at the same time as this phase): navigating its library/board UI
 * lands on `http://.../items/itm_<n>` for the item detail page. Not a guess — observed directly.
 */
function itemHref(itemId: string): string {
  return `/items/${itemId}`
}

export interface CitationChipsProps {
  sources: ChatSourceVM[]
}

/**
 * The numbered `[1]`/`[2]` reference list under a grounded answer (P13.4) — every chip links to
 * the item detail page. Rendered only when `sources.length > 0`; the caller (ChatMessage) is what
 * decides not to render this at all for an ungrounded ("nothing found") turn.
 */
export function CitationChips({ sources }: CitationChipsProps) {
  if (sources.length === 0) return null

  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Sources">
      {sources.map((source) => (
        <li key={source.index}>
          <a
            href={itemHref(source.item_id)}
            className={[
              'inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-card',
              'px-2.5 text-xs font-medium text-foreground no-underline',
              'hover:bg-accent hover:text-accent-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            ].join(' ')}
          >
            <span
              className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground"
              aria-hidden="true"
            >
              {source.index}
            </span>
            <span className="max-w-40 truncate sm:max-w-56">{source.title ?? 'Untitled'}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

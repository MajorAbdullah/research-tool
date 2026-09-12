/**
 * Local type definitions for `src/components/library/**` and the `(library)` route group.
 *
 * Follows the same convention `src/components/common/types.ts` established (see that file's own
 * comment): wire shapes this phase depends on but doesn't own are re-declared here, value for
 * value, from `docs/API.md` §2 — rather than imported from `@/services/wire-types.ts`. Two
 * concrete reasons, not just precedent-following:
 *
 *  1. `@/services/**` sits behind route handlers that pull in `better-sqlite3`/drizzle through
 *     their module graph; several files in this directory are `'use client'` and get bundled for
 *     the browser. A stray non-type import from `@/services/items-service.ts` (easy to do by
 *     accident once two files re-export from the same barrel) would try to ship a native SQLite
 *     binding to the browser. Depending only on local types makes that class of mistake
 *     impossible rather than merely avoided by discipline. (`import type` from `@/services/**` IS
 *     erased at compile time and would be safe on its own, but keeping this directory
 *     self-contained means one convention to follow, not "type-only is fine, value isn't".)
 *  2. `ItemSummary` already lives in `@/components/common/types.ts` and is what `ItemCard` (P5)
 *     renders — imported directly below rather than redeclared a third time, since that one's
 *     already the shared cross-phase vocabulary for the summary shape.
 */

import type { ItemSummary } from '@/components/common/types'

export type {
  ItemKind,
  ItemStatus,
  ExtractionTier,
  SourceSurface,
  Topic,
  ItemSummary,
} from '@/components/common/types'

/** `GET /api/v1/search`'s per-result extension of `ItemSummary` (docs/API.md §3.2). */
export interface SearchResultSummary extends ItemSummary {
  /**
   * Plain text excerpt — never pre-highlighted HTML (docs/API.md §3.2). Typed nullable, though
   * the doc's own example always shows a string: `src/lib/search/hybrid-search.ts`'s
   * `buildChunkSnippet` returns `null` when the best-matching chunk row is missing at hydration
   * time (a real, if rare, reachable path — a deleted/reindexed chunk), which would otherwise
   * leak as `"snippet": null` over a wire documented as always-string. See this phase's final
   * report.
   */
  snippet: string | null
  /** Fused RRF score. Debug-only; never rendered as a raw number to the user. */
  score: number
}

/** `Item.kind_fields` when `kind === 'github'` (docs/API.md §2). */
export interface GithubKindFields {
  language: string | null
  stars: number
  license: string | null
  /** epoch ms */
  last_commit: number | null
  what_it_does: string | null
  primary_use_case: string | null
}

export type RelationType = 'alternative' | 'similar' | 'supersedes'

/** One row of `Item.relations` (docs/API.md §2). */
export interface ItemRelation {
  item_id: string
  title: string | null
  kind: ItemSummary['kind']
  type: RelationType
  /**
   * Live API observation (2026-09-12, seeded data): every relation the `relate` pipeline stage
   * had actually produced by the time this phase ran came back with `rationale: ""`, not the
   * descriptive sentence docs/API.md's example implies. Every renderer of this field must treat
   * empty string as "no rationale available" and degrade gracefully — never render a label like
   * "Why: " followed by nothing. See this phase's final report.
   */
  rationale: string
  score: number
}

/** `GET /api/v1/items/:id` (docs/API.md §2 `Item`). */
export interface ItemDetail extends ItemSummary {
  summary_bullets: string[]
  content_text: string | null
  published_at: number | null
  kind_fields: GithubKindFields | null
  note: string | null
  outcome_note: string | null
  failure_reason: string | null
  relations: ItemRelation[]
}

/** The envelope every list endpoint uses (docs/API.md §1.4/§1.6). */
export interface WirePage<T> {
  data: T[]
  page: { next_cursor: string | null; has_more: boolean }
}

/**
 * UI-only grouping modes (plan §10.1.4: "kind (video/text/audio/repo) · topic · status · date").
 * Purely a client-side re-bucketing of one flat, filtered, sorted list — docs/API.md §3.3: "the
 * server doesn't have a separate 'grouped' response shape" — so this never affects what gets
 * fetched, only how the same items are displayed.
 */
export type GroupBy = 'none' | 'kind' | 'topic' | 'status' | 'date'

/**
 * Deliverable #5 asks for exactly these three ("newest, oldest, recently opened") — a deliberate
 * subset of `@/services/items-schema.ts`'s four-value `SortMode` (which also has `most_related`,
 * a P9 addition this phase's brief doesn't ask for). Every value here is a valid value of that
 * wider API enum, so no translation is needed when building fetch params — just a narrower type
 * at this layer.
 */
export type LibrarySortMode = 'newest' | 'oldest' | 'recently_opened'

/** The filter vocabulary shared by `GET /api/v1/items` and `GET /api/v1/search` (docs/API.md §3.2/§3.3). */
export interface LibraryFilters {
  kind: string[]
  topic: string[]
  tag: string[]
  status: string[]
  extractionTier: string[]
  dateFrom?: number
  dateTo?: number
}

/** The full URL-encodable browsing state (query text + filters + sort). `group` is deliberately excluded — see `GroupBy`'s comment. */
export interface LibraryQueryState {
  q: string
  filters: LibraryFilters
  sort: LibrarySortMode
}

export const EMPTY_FILTERS: LibraryFilters = {
  kind: [],
  topic: [],
  tag: [],
  status: [],
  extractionTier: [],
}

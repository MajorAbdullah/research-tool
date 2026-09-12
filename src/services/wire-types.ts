/**
 * The HTTP wire shapes from docs/API.md §2 ("Shared types"). `src/types/contracts.ts` is
 * explicit that it holds the *internal* DB/TS shapes and that the HTTP contract is intentionally
 * separate (P0/P8/P9 build against the same enum string values, but the wire shapes themselves —
 * `ItemSummary`, `Item`, etc. — live wherever the HTTP layer that returns them is built). This is
 * that file for this phase's routes.
 */

import type {
  ExtractionTier,
  ItemKind,
  ItemStatus,
  RelationType,
  SourceSurface,
  UtcMillis,
} from '@/types/contracts'

export interface WireTopic {
  slug: string
  label: string
  color: string
  confidence: number
}

/** Returned in every list of items (docs/API.md §2). */
export interface ItemSummaryWire {
  id: string
  kind: ItemKind
  status: ItemStatus
  title: string | null
  author: string | null
  url: string
  canonical_url: string
  thumbnail_url: string | null
  extraction_tier: ExtractionTier
  source_surface: SourceSurface
  summary_tldr: string | null
  topic: WireTopic | null
  tags: string[]
  starred: boolean
  board_rank: number | null
  created_at: UtcMillis
  updated_at: UtcMillis
  last_opened_at: UtcMillis | null
}

export interface GithubKindFieldsWire {
  language: string | null
  stars: number
  license: string | null
  last_commit: UtcMillis | null
  what_it_does: string | null
  primary_use_case: string | null
}

export interface ItemRelationWire {
  item_id: string
  title: string | null
  kind: ItemKind
  type: RelationType
  rationale: string
  score: number
}

/** `GET /api/v1/items/:id` and the object returned by every mutating items endpoint. */
export interface ItemWire extends ItemSummaryWire {
  summary_bullets: string[]
  content_text: string | null
  published_at: UtcMillis | null
  kind_fields: GithubKindFieldsWire | null
  note: string | null
  outcome_note: string | null
  failure_reason: string | null
  relations: ItemRelationWire[]
}

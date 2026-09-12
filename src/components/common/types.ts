/**
 * Local type definitions for the components in `common/`.
 *
 * P0 owns `src/types/contracts.ts`, which was still being written when this
 * phase started, so these are intentionally re-declared here rather than
 * imported — they mirror `docs/API.md` §2 ("Shared types") exactly, value
 * for value. When contracts.ts lands, replace this file's contents with
 * `export type { ... } from '@/types/contracts'` and delete the duplication;
 * every file in `common/` imports from here, not from a scattered set of
 * inline unions, so that swap is a one-file change.
 */

export type ItemKind = 'github' | 'video' | 'article' | 'social' | 'pdf' | 'audio' | 'other'

export type ItemStatus =
  | 'queued' // captured, not yet picked up by the pipeline
  | 'processing' // pipeline is running
  | 'inbox' // pipeline finished, unreviewed — first board column
  | 'to_test'
  | 'testing'
  | 'tested'
  | 'archived'
  | 'dropped'
  | 'failed' // pipeline hit a permanent error — see failure_reason

export type ExtractionTier = 'full' | 'partial' | 'metadata_only'

export type SourceSurface = 'extension' | 'pwa' | 'web' | 'import'

export interface Topic {
  slug: string
  label: string
  /** CSS color token, e.g. "#6366f1" — LLM- or user-assigned, not part of the design system palette. */
  color: string
  /** 0..1, how sure enrichment was; 1.0 for a manual override. */
  confidence: number
}

/** Mirrors docs/API.md's `ItemSummary` — what ItemCard renders. */
export interface ItemSummary {
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
  topic: Topic | null
  tags: string[]
  starred: boolean
  board_rank: number | null
  created_at: number
  updated_at: number
  last_opened_at: number | null
}

/**
 * Request parsing/validation for every `/api/v1/items/**` route this phase owns (docs/API.md
 * §3.3–§3.7). Query-string parsing (list filters) is plain hand-written parsing rather than Zod
 * — `URLSearchParams` values are always strings needing comma-splitting first, which doesn't fit
 * Zod's object-shape model as naturally as the JSON bodies below do — but every rejection still
 * goes through `ApiError.validation` so the wire error shape is identical either way.
 */

import { z } from 'zod'
import { ExtractionTier, ItemKind, ItemStatus, JobName } from '@/types/contracts'
import type {
  ExtractionTier as ExtractionTierType,
  ItemKind as ItemKindType,
  ItemStatus as ItemStatusType,
  JobName as JobStage,
} from '@/types/contracts'
import { ApiError } from '@/services/http'
import { MAX_TAGS_PER_ITEM } from '@/services/tags'

// ---------------------------------------------------------------------------
// GET /api/v1/items — list query (docs/API.md §3.3)
// ---------------------------------------------------------------------------

export type SortMode = 'newest' | 'oldest' | 'recently_opened' | 'most_related'
const SORT_VALUES: readonly SortMode[] = ['newest', 'oldest', 'recently_opened', 'most_related']

export interface ItemsListQuery {
  kind?: ItemKindType[]
  topic?: string[]
  status?: ItemStatusType[]
  tag?: string[]
  extractionTier?: ExtractionTierType[]
  dateFrom?: number
  dateTo?: number
  cursor?: string
  limit: number
  sort: SortMode
}

function parseEnumCsv<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  field: string,
): T[] | undefined {
  if (raw === null || raw.trim() === '') return undefined
  const values = raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
  for (const value of values) {
    if (!(allowed as readonly string[]).includes(value)) {
      throw ApiError.validation(`${field} must be one of: ${allowed.join(', ')}`, {
        field,
        reason: `invalid value "${value}"`,
      })
    }
  }
  return values as T[]
}

/** Free-text filters (topic slugs, tag labels) — comma-split only, no enum to validate against. */
function parseCsv(raw: string | null): string[] | undefined {
  if (raw === null || raw.trim() === '') return undefined
  const values = raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
  return values.length > 0 ? values : undefined
}

function parseEpochMs(raw: string | null, field: string): number | undefined {
  if (raw === null || raw.trim() === '') return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    throw ApiError.validation(`${field} must be an epoch-millisecond integer`, {
      field,
      reason: 'not a number',
    })
  }
  return value
}

const ITEM_KIND_VALUES = Object.values(ItemKind)
const ITEM_STATUS_VALUES = Object.values(ItemStatus)
const EXTRACTION_TIER_VALUES = Object.values(ExtractionTier)

export function parseItemsListQuery(searchParams: URLSearchParams): ItemsListQuery {
  const rawLimit = searchParams.get('limit')
  const limitNum = rawLimit === null ? Number.NaN : Number.parseInt(rawLimit, 10)
  // docs/API.md §1.6: "Values outside 1..100 are clamped, not rejected."
  const limit = Number.isFinite(limitNum) ? Math.min(100, Math.max(1, limitNum)) : 20

  const rawSort = searchParams.get('sort')
  const sort = rawSort === null || rawSort.trim() === '' ? 'newest' : rawSort.trim()
  if (!SORT_VALUES.includes(sort as SortMode)) {
    throw ApiError.validation(`sort must be one of: ${SORT_VALUES.join(', ')}`, {
      field: 'sort',
      reason: `invalid value "${sort}"`,
    })
  }

  return {
    kind: parseEnumCsv(searchParams.get('kind'), ITEM_KIND_VALUES, 'kind'),
    topic: parseCsv(searchParams.get('topic')),
    status: parseEnumCsv(searchParams.get('status'), ITEM_STATUS_VALUES, 'status'),
    tag: parseCsv(searchParams.get('tag')),
    extractionTier: parseEnumCsv(
      searchParams.get('extraction_tier'),
      EXTRACTION_TIER_VALUES,
      'extraction_tier',
    ),
    dateFrom: parseEpochMs(searchParams.get('date_from'), 'date_from'),
    dateTo: parseEpochMs(searchParams.get('date_to'), 'date_to'),
    cursor: searchParams.get('cursor') ?? undefined,
    limit,
    sort: sort as SortMode,
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/items/:id (docs/API.md §3.5)
// ---------------------------------------------------------------------------

export const ItemPatchSchema = z
  .object({
    note: z.string().nullable().optional(),
    outcome_note: z.string().nullable().optional(),
    starred: z.boolean().optional(),
    tags: z
      .array(z.string().min(1))
      .max(MAX_TAGS_PER_ITEM, `tags cannot exceed ${MAX_TAGS_PER_ITEM} entries`)
      .optional(),
    topic: z.string().min(1).nullable().optional(),
  })
  .strict()

export type ItemPatchBody = z.infer<typeof ItemPatchSchema>

// ---------------------------------------------------------------------------
// PATCH /api/v1/items/:id/status (docs/API.md §3.6)
// ---------------------------------------------------------------------------

export const ItemStatusPatchSchema = z.object({
  status: z.enum(ITEM_STATUS_VALUES as [string, ...string[]]),
})

// ---------------------------------------------------------------------------
// POST /api/v1/items/:id/retry (docs/API.md §3.7)
// ---------------------------------------------------------------------------

const JOB_STAGE_VALUES = Object.values(JobName) as [JobStage, ...JobStage[]]

export const ItemRetrySchema = z.object({
  stage: z.enum(JOB_STAGE_VALUES),
  html: z.string().optional(),
  transcript: z.string().optional(),
  caption: z.string().optional(),
})

export type ItemRetryBody = z.infer<typeof ItemRetrySchema>

/**
 * Parses+validates `GET /api/v1/search`'s query string (docs/API.md §3.2) into a typed,
 * `SearchFilters`-shaped request. All validation failures surface as one `z.ZodError` so the route
 * handler has exactly one thing to catch and map to `400 VALIDATION_ERROR` (§1.5) — `ctx.addIssue`
 * inside each field's `.transform()` is what lets an enum/number problem join the same error
 * object a missing/empty `q` would produce, rather than needing two different catch branches.
 */

import { z } from 'zod'
import { ExtractionTier, ItemKind, ItemStatus } from '@/types/contracts'
import type { SearchFilters } from './filters'

// Cast, not hand-copied: `Object.values()` on these frozen P0 enum objects (contracts.ts) widens
// to `string[]` at the type level (this codebase's existing convention — see queue.ts's
// `JOB_NAMES` doing the same), so the cast just restores the literal-union type this schema
// needs; it adds no runtime assumption beyond "contracts.ts's enums are non-empty," which they are.
const ITEM_KIND_VALUES = Object.values(ItemKind) as [ItemKind, ...ItemKind[]]
const ITEM_STATUS_VALUES = Object.values(ItemStatus) as [ItemStatus, ...ItemStatus[]]
const EXTRACTION_TIER_VALUES = Object.values(ExtractionTier) as [
  ExtractionTier,
  ...ExtractionTier[],
]

function enumListField<T extends string>(allowed: readonly T[]) {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined) return undefined
      const values = raw
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
      const allowedSet = new Set<string>(allowed)
      for (const value of values) {
        if (!allowedSet.has(value)) {
          ctx.addIssue({
            code: 'custom',
            message: `'${value}' is not one of: ${allowed.join(', ')}`,
          })
          return undefined
        }
      }
      return values.length > 0 ? (values as T[]) : undefined
    })
}

function freeTextListField() {
  return z
    .string()
    .optional()
    .transform((raw) =>
      raw === undefined
        ? undefined
        : raw
            .split(',')
            .map((v) => v.trim())
            .filter((v) => v.length > 0),
    )
}

function epochMsField() {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined) return undefined
      const n = Number(raw)
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: 'custom', message: 'must be an epoch-millisecond number' })
        return undefined
      }
      return n
    })
}

const SearchQuerySchema = z.object({
  // Defaulted to '' (not left undefined) so a missing `q` and an empty `q` produce the exact same
  // `.min(1, ...)` message, rather than needing a separate "field is missing" branch.
  q: z.string().trim().min(1, 'q is required'),
  kind: enumListField(ITEM_KIND_VALUES),
  topic: freeTextListField(),
  tag: freeTextListField(),
  status: enumListField(ITEM_STATUS_VALUES),
  extraction_tier: enumListField(EXTRACTION_TIER_VALUES),
  date_from: epochMsField(),
  date_to: epochMsField(),
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined) return undefined
      const n = Number(raw)
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: 'custom', message: 'limit must be a number' })
        return undefined
      }
      return n
    }),
  // Additive, undocumented-in-API.md extension for deliverable #6 (search-as-you-type's instant
  // FTS-only tier) — omitting it reproduces exactly the documented default (fused hybrid)
  // behavior, so existing/documented clients see no change.
  tier: z.enum(['fts', 'hybrid']).optional(),
})

export interface ParsedSearchQuery {
  q: string
  filters: SearchFilters
  cursor?: string
  limit?: number
  tier: 'fts' | 'hybrid'
}

/** Throws `z.ZodError` on any validation failure — callers (the route handler) catch that one
 *  type and map `issues[0]` to docs/API.md §1.5's `{code, message, details}` shape. */
export function parseSearchQuery(params: URLSearchParams): ParsedSearchQuery {
  const parsed = SearchQuerySchema.parse({
    q: params.get('q') ?? '',
    kind: params.get('kind') ?? undefined,
    topic: params.get('topic') ?? undefined,
    tag: params.get('tag') ?? undefined,
    status: params.get('status') ?? undefined,
    extraction_tier: params.get('extraction_tier') ?? undefined,
    date_from: params.get('date_from') ?? undefined,
    date_to: params.get('date_to') ?? undefined,
    cursor: params.get('cursor') ?? undefined,
    limit: params.get('limit') ?? undefined,
    tier: params.get('tier') ?? undefined,
  })

  return {
    q: parsed.q,
    filters: {
      kind: parsed.kind,
      topic: parsed.topic,
      tag: parsed.tag,
      status: parsed.status,
      extractionTier: parsed.extraction_tier,
      dateFrom: parsed.date_from,
      dateTo: parsed.date_to,
    },
    cursor: parsed.cursor,
    limit: parsed.limit,
    tier: parsed.tier ?? 'hybrid',
  }
}

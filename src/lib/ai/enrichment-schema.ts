/**
 * The Zod schema for `EnrichmentResult` (src/types/contracts.ts) — this is the "Zod on
 * everything" half of the prompt-injection defence (CLAUDE.md point 3) and the concrete
 * implementation of P3.2.1c's cardinality caps.
 *
 * `status` is not, and must never become, a field here. `EnrichmentResult` doesn't declare it
 * (contracts.ts's own comment explains why), and `z.object()`'s default "strip unknown keys"
 * behavior means that even if a compromised model response includes a `status` (or any other)
 * field never described here, `.parse()`/`.safeParse()` silently drops it — the model has no path
 * to set it, whether or not it tries.
 */

import { z } from 'zod'
import type { ZodType } from 'zod'
import { ItemKind } from '@/types/contracts'
import type { EnrichmentResult, ItemKind as ItemKindType } from '@/types/contracts'

/** 3-8 per P3.2.1/P3.2.1c — a floor so tagging isn't useless, a ceiling so it can't be spammed. */
export const TAG_COUNT_MIN = 3
export const TAG_COUNT_MAX = 8
/** 3-5 per P3.2.1. */
export const BULLET_COUNT_MIN = 3
export const BULLET_COUNT_MAX = 5

export const enrichmentResultSchema = z.object({
  tldr: z.string().min(1).max(600),
  bullets: z.array(z.string().min(1).max(400)).min(BULLET_COUNT_MIN).max(BULLET_COUNT_MAX),
  tags: z.array(z.string().min(1).max(40)).min(TAG_COUNT_MIN).max(TAG_COUNT_MAX),
  topic: z.string().min(1).max(80),
  confidence: z.number().min(0).max(1),
  kindFields: z.record(z.string(), z.unknown()).optional(),
})

/** P3.2.2: GitHub/repo items additionally ask the model for these two fields inside `kindFields`.
 *  Everything else in a repo's `kindFields` (language, stars, license, last_commit) comes from the
 *  extractor (P2), not the model — see contracts.ts's `ExtractedContent.kindFields` doc — and is
 *  merged in by `enrichItem()` after validation, not requested from the model at all. */
export const repoKindFieldsSchema = z.object({
  what_it_does: z.string().min(1).max(300),
  primary_use_case: z.string().min(1).max(300),
})

const repoEnrichmentResultSchema = enrichmentResultSchema.extend({
  kindFields: repoKindFieldsSchema,
})

/** Selects the schema sent to the model: repo items are additionally required to fill in
 *  `kindFields.{what_it_does,primary_use_case}`; every other kind uses the base schema, where
 *  `kindFields` stays optional. Both branches are structurally `EnrichmentResult`-shaped — the
 *  repo branch just narrows `kindFields` to a subtype of `Record<string, unknown>`. */
export function buildEnrichmentSchema(kind: ItemKindType): ZodType<EnrichmentResult> {
  return kind === ItemKind.Github ? repoEnrichmentResultSchema : enrichmentResultSchema
}

/**
 * The progressive two-tier search decision (deliverable #2: "the API supports `tier=fts` for an
 * instant keyword-only tier then the fused result — use it for responsiveness"). Extracted as a
 * pure function so the branching is unit-testable without mounting `useLibraryItems`'s React
 * Query hooks: show the fast FTS-only result the instant it lands, then swap to the slower, fused
 * hybrid result as soon as THAT resolves — including the case where hybrid resolves to genuinely
 * zero matches, which must win over a stale non-empty FTS result, not be masked by it.
 */

import type { SearchResultSummary } from '@/components/library/types'

export function pickSearchItems(
  ftsItems: readonly SearchResultSummary[],
  hybridItems: readonly SearchResultSummary[],
  hybridReady: boolean,
): readonly SearchResultSummary[] {
  return hybridReady ? hybridItems : ftsItems
}

/**
 * Reciprocal Rank Fusion (k=60 by default) — combines multiple independently-ranked lists of item
 * ids into one fused ranking, using ONLY each list's rank *positions*, never the underlying
 * scores.
 *
 * This is the entire reason RRF is used over a hand-tuned weighted average (rag-best-practices
 * §3, CLAUDE.md, this phase's own brief): `bm25()` and `vec0` distance live on completely
 * incomparable scales — `bm25` is an unbounded, corpus-frequency-dependent value; cosine/L2
 * distance is dataset-shape dependent — averaging them directly would require made-up
 * normalization constants that drift as the corpus changes. A rank position needs no
 * normalization at all, which is exactly what makes RRF robust without per-corpus tuning.
 */

export const DEFAULT_RRF_K = 60

/** One retriever's ranked output: item ids, best match first. Ties within a list are the
 *  caller's problem to break before handing the list here — RRF only ever sees a strict order. */
export type RankedIds = readonly number[]

export interface FusedResult {
  id: number
  /** Sum of `1/(k + rank)` over every input list that contained this id (rank is 1-based). This
   *  is docs/API.md §3.2's `score` field on a search result. */
  score: number
  /** Debugging aid: the 1-based rank this id held in each named list, omitted for lists that
   *  didn't contain it at all. */
  ranks: Record<string, number>
}

/**
 * `rankings` is a name -> ordered-id-list map (e.g. `{ fts: [...], vector: [...] }`) rather than
 * a fixed two-arity signature, so callers/tests can see which retriever contributed to a given
 * fused score, and so this generalizes to more than two rankings without a signature change.
 *
 * Output is sorted by descending fused score, ties broken by ascending id — a deterministic,
 * fully reproducible order (JS's `Array.prototype.sort` is stable, but an explicit tiebreak makes
 * the ordering a property of the *data*, not of whatever sort algorithm happens to be running).
 */
export function reciprocalRankFusion(
  rankings: Readonly<Record<string, RankedIds>>,
  k: number = DEFAULT_RRF_K,
): FusedResult[] {
  const byId = new Map<number, { score: number; ranks: Record<string, number> }>()

  for (const [name, ids] of Object.entries(rankings)) {
    ids.forEach((id, index) => {
      const rank = index + 1
      const contribution = 1 / (k + rank)
      const existing = byId.get(id)
      if (existing) {
        existing.score += contribution
        existing.ranks[name] = rank
      } else {
        byId.set(id, { score: contribution, ranks: { [name]: rank } })
      }
    })
  }

  return Array.from(byId.entries())
    .map(([id, { score, ranks }]) => ({ id, score, ranks }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id - b.id))
}

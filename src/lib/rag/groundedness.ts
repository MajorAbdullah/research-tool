/**
 * The pre-generation groundedness gate (P13.5) — decides whether retrieval found ENOUGH to even
 * attempt an answer, before spending an LLM call. Deliberately conservative: it only refuses to
 * generate on the clear, cheap-to-detect cases (nothing retrieved at all, or a semantic distance
 * so poor it's obviously unrelated). It is NOT the only hallucination guard — see
 * `prompts/chat.v1.md` and `citations.ts` for the second and third layers.
 *
 * ## Why this isn't a single vector-distance threshold
 *
 * Verified empirically against the real 4-item corpus (`data/sieve.db`) with the real local
 * embedder: a query about a topic genuinely absent from the library (e.g. "Kubernetes operators")
 * produced a best vector distance of ~0.75 — *better* (smaller) than the distance for some
 * queries that ARE genuinely answerable by the library (e.g. a query needing the exact term
 * "PagedAttention" scored ~0.83-0.88 on vector alone, and only hybrid search's FTS half rescues
 * it). On a small, topically-narrow corpus, embedding distance alone does not reliably separate
 * "on topic" from "off topic" — the gap is a few hundredths, not an order of magnitude. A tight
 * threshold tuned to reject the one negative example on hand would also reject real positives;
 * this is the same lesson `prompts/CHANGELOG.md`'s enrichment.v2 entry already drew for topic
 * assignment ("the threshold was NOT at fault... the fix belongs in the prompt, not the
 * threshold") — applied here rather than re-litigated.
 *
 * So this gate only fires on the cases numeric signals CAN detect reliably: zero results (an
 * empty library, or a query with no lexical or vector match returned at all — the "nothing-found"
 * UI state), or a distance so large it is outside the range any real query in this corpus has
 * ever produced. The harder case — "the library has stuff, but not about this" (e.g. a query
 * that spuriously lexically overlaps an unrelated item, such as "what did I save about X"
 * matching a bookmark-manager README on the word "save") — is deliberately left to the model
 * itself, instructed and required to cite, and to the citation validator's corrective retry.
 * Defense in depth: three cheap layers instead of one over-tuned number.
 */

/**
 * Generous ceiling for BGE-family L2 distance (unit-ish vectors: 0 = identical, ~1.4 = roughly
 * orthogonal). Chosen well above every distance observed for a real match in this project's
 * corpus (~0.60-0.75) and even above every distance observed for a genuinely unrelated query
 * (~0.82-0.88) — this branch is a backstop for a much larger semantic gap than this project's
 * small corpus has ever produced, not the primary defense. See file header.
 */
export const VECTOR_DISTANCE_CEILING = 1.1

export interface GroundednessSignal {
  /** How many items `hybridSearch()` returned at all. */
  itemCount: number
  /** Did keyword search return ANY row for this query (any item, any rank)? FTS5 structurally
   *  cannot return a row with zero token overlap, so this is a genuine (if sometimes
   *  over-eager — see file header) lexical-overlap signal. */
  hasAnyFtsHit: boolean
  /** Smallest raw vector distance found across all candidates, or `null` if the corpus has no
   *  embedded chunks at all yet. */
  bestVectorDistance: number | null
}

/**
 * The fixed message streamed on the ungrounded path (docs/API.md §3.8: a normal `token` event,
 * not an error — answering "I don't know" doesn't need to look like a failure). Not a
 * `prompts/*.md` file: this text is never sent to a model, it's the literal UI/assistant copy for
 * when generation is skipped entirely — `prompts/` is reserved for text that IS an LLM prompt
 * (CLAUDE.md/genai-best-practices).
 */
export const INSUFFICIENT_CONTEXT_MESSAGE =
  "I don't have anything saved that answers this. Try rephrasing, narrowing the scope filter, or save something on this topic first."

/**
 * `true` means "retrieval found enough to be worth an LLM call." Pure function — no I/O — so it's
 * unit-tested directly against fixture signals, independent of the database or the embedder.
 */
export function isPreGenerationGrounded(signal: GroundednessSignal): boolean {
  if (signal.itemCount === 0) return false
  if (signal.hasAnyFtsHit) return true
  return signal.bestVectorDistance !== null && signal.bestVectorDistance <= VECTOR_DISTANCE_CEILING
}

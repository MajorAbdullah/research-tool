/**
 * Shared types for the chat/RAG pipeline (retrieval -> context assembly -> answer generation).
 *
 * This is the pipeline's INTERNAL contract — distinct from docs/API.md §3.8's wire shapes (the
 * `sources`/`done` SSE event payloads), the same way `src/lib/search/item-summary.ts`'s
 * `SearchResultItem` is distinct from `ItemSummary`. `src/app/api/v1/chat/route.ts` maps these to
 * the wire shape at the edge; nothing under `src/lib/rag/**` imports from the route.
 */

import type { ItemKind } from '@/types/contracts'

/** docs/API.md §3.8's `ChatRequest.filters` — "only search my repos" (P13.6). */
export interface ChatFilters {
  kind?: ItemKind
  topic?: string
}

/** One numbered reference the model was given and told to cite as `[n]` — the unit citation
 *  chips render from, and what docs/API.md §3.8's `sources` event carries. */
export interface ChatSource {
  index: number
  itemId: number
  wireId: string
  title: string | null
  kind: ItemKind
  canonicalUrl: string
}

/**
 * Every chunk retrieval considered for a turn, whether or not it made it into the assembled
 * context — logged with every answer (CLAUDE.md → RAG: "log retrieved chunks with every answer";
 * rag-best-practices §3/§6: "when a query fails, [this] tells you whether the failure is a
 * vocabulary mismatch or a genuine relevance problem"). Never sent to the client — server log +
 * `chat_messages.retrieved_chunks` only.
 */
export interface RetrievedChunkLogEntry {
  itemId: number
  chunkId: number
  ord: number
  /** Raw `bm25()` rank for this ITEM (smaller/more negative is better), `null` if FTS didn't
   *  return it at all. Item-level, not chunk-level — see fts-search.ts; that's the granularity
   *  Sieve's own retrieval layer exposes. */
  ftsRank: number | null
  /** Raw vector distance for this item's best-matching chunk, `null` if vector search didn't
   *  return it. */
  vectorDistance: number | null
  /** The fused RRF score `hybridSearch()` assigned this item. */
  fusedScore: number | null
  includedInContext: boolean
}

export interface ContextBlock {
  /** Citation index, 1-based, matching `ChatSource.index`. */
  index: number
  /** Ready to interpolate into the prompt: labeled and delimited as untrusted content. */
  text: string
}

/** One retrieved chunk, still raw (un-assembled) — chunks/config are the DB-touching seam's job
 *  (`retrieve.ts`); everything below this point (`context-assembly.ts`) is a pure function over
 *  this shape, so token-budgeting and source-ordering are unit-testable without a database. */
export interface CandidateChunk {
  chunkId: number
  /** Position within its own source document — the ordering "re-sort into source order" sorts
   *  by, never similarity rank. */
  ord: number
  text: string
  ftsRank: number | null
  vectorDistance: number | null
}

export interface CandidateItem {
  itemId: number
  wireId: string
  title: string | null
  kind: ItemKind
  canonicalUrl: string
  /** The fused RRF score from `hybridSearch()` — this IS the retrieval ranking; context assembly
   *  only ever consumes this order, never re-derives its own. */
  fusedScore: number
  /** This item's chunks, already `ORDER BY ord ASC` (source order) and capped at
   *  `maxChunksPerItem` — see retrieve.ts. */
  chunks: CandidateChunk[]
}

export interface RetrieveRawResult {
  /** Ranked by `hybridSearch()`'s fused order; empty when nothing matched at all. */
  items: CandidateItem[]
  /** The pre-generation groundedness signal (see groundedness.ts) — cheap, DB/vector-only, no
   *  LLM cost. `false` means retrieval itself found nothing worth even attempting an answer from. */
  groundedPreGate: boolean
}

export interface AssembledContext {
  /** Only sources that actually made it into context, in citation order (== relevance order). */
  sources: ChatSource[]
  contextBlocks: ContextBlock[]
  retrievedChunks: RetrievedChunkLogEntry[]
  /** Did the token budget cut off part of what retrieval found? Logged, not shown to the user. */
  truncated: boolean
}

/** One prior turn, for conversation history (P13.6) — text only, never the old turn's retrieved
 *  context (that would grow the prompt unboundedly; a fresh retrieval runs every turn). */
export interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

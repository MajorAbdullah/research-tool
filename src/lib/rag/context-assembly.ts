/**
 * Context assembly: turns ranked, chunk-hydrated candidates into a token-budgeted, delimited,
 * citation-numbered prompt context. Pure — no I/O, no database — so every rule here (source
 * ordering, budget cutoff, delimiting) is unit-tested directly against hand-built fixtures
 * (`tests/unit/rag/context-assembly.test.ts`) rather than through a live retrieval.
 *
 * Two rules this module exists to enforce, both non-negotiable per CLAUDE.md → RAG:
 *
 *   1. **Source order, not similarity order, within an item.** `CandidateItem.chunks` arrives
 *      already `ORDER BY ord ASC` (retrieve.ts) — this module only ever concatenates them in that
 *      order. A multi-chunk transcript read in similarity-rank order is incoherent; reading it in
 *      the order it was said is not.
 *   2. **Untrusted-content discipline.** Every source's text is wrapped in
 *      `<untrusted_content>` via `@/lib/ai`'s `wrapUntrustedContent` — the exact same primitive
 *      P3's enrichment prompt uses. An item already sitting in the user's own library is still
 *      untrusted input (CLAUDE.md's Prompt Injection section, point 5).
 *
 * Citation index == relevance rank: items are offered to the budget in `hybridSearch()`'s own
 * fused order (the caller's responsibility to supply them that way), and this module assigns `[1]`
 * to the first one that fits, `[2]` to the next, and so on — it never reorders by anything of its
 * own. Once one item doesn't fit the remaining budget, assembly stops outright (a lower-ranked
 * item slipping in around a higher-ranked one just because it happens to be shorter would make
 * "index == relevance" a lie); the only exception is the very first item, which is truncated
 * rather than dropped, so a genuinely-grounded query is never left with zero sources purely
 * because its best source ran long.
 */

import type { ItemKind } from '@/types/contracts'
import { estimateTokens, truncateToTokenBudget, wrapUntrustedContent } from '@/lib/ai'
import type {
  AssembledContext,
  CandidateChunk,
  CandidateItem,
  ChatSource,
  ContextBlock,
  RetrievedChunkLogEntry,
} from './types'

/**
 * Deliberately well under the multi-hundred-thousand-token windows `LLM_CHAIN_CHAT` models
 * support (ADR 0005) — rag-best-practices §4: "keep retrieved context relevant and minimal...
 * dumping every marginally-related chunk in raises cost and latency and increases the chance the
 * model latches onto the wrong passage." Generous enough to hold several full items from this
 * project's real corpus (the largest real item chunks to ~1,600 tokens) without truncation.
 */
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 6000

export interface AssembleContextOptions {
  tokenBudget?: number
}

function formatBlock(index: number, item: CandidateItem, text: string): string {
  const label = `Source [${index}]: "${item.title ?? 'Untitled'}" (${item.kind})`
  return `${label}\n${wrapUntrustedContent(text)}`
}

function logEntry(
  item: CandidateItem,
  chunk: CandidateChunk,
  includedInContext: boolean,
): RetrievedChunkLogEntry {
  return {
    itemId: item.itemId,
    chunkId: chunk.chunkId,
    ord: chunk.ord,
    ftsRank: chunk.ftsRank,
    vectorDistance: chunk.vectorDistance,
    fusedScore: item.fusedScore,
    includedInContext,
  }
}

/**
 * Sorts defensively by `ord` rather than trusting the input array's order — `retrieve.ts` already
 * fetches chunks `ORDER BY ord ASC`, but "re-sort into source order" (CLAUDE.md → RAG) is this
 * module's own guarantee to make, not something it should merely inherit from an upstream SQL
 * clause a future change could quietly break.
 */
function joinChunks(chunks: readonly CandidateChunk[]): string {
  return [...chunks]
    .sort((a, b) => a.ord - b.ord)
    .map((c) => c.text.trim())
    .join('\n\n')
}

export interface CitationItemMeta {
  itemId: number
  wireId: string
  title: string | null
  kind: ItemKind
  canonicalUrl: string
}

function toSource(index: number, item: CitationItemMeta): ChatSource {
  return {
    index,
    itemId: item.itemId,
    wireId: item.wireId,
    title: item.title,
    kind: item.kind,
    canonicalUrl: item.canonicalUrl,
  }
}

export function assembleContext(
  items: readonly CandidateItem[],
  options: AssembleContextOptions = {},
): AssembledContext {
  const budget = options.tokenBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET

  const sources: ChatSource[] = []
  const contextBlocks: ContextBlock[] = []
  const retrievedChunks: RetrievedChunkLogEntry[] = []
  let usedTokens = 0
  let truncated = false
  let stoppedAtIndex = -1

  items.forEach((item, position) => {
    if (stoppedAtIndex !== -1) {
      // Budget already exhausted by an earlier (higher-ranked) item — log every remaining
      // candidate's chunks as considered-but-excluded (deliverable: log retrieved chunks with
      // every answer, win or lose) without spending any more budget-accounting effort on them.
      for (const chunk of item.chunks) retrievedChunks.push(logEntry(item, chunk, false))
      return
    }

    const bodyText = joinChunks(item.chunks)
    const itemTokens = estimateTokens(bodyText)

    if (usedTokens + itemTokens > budget) {
      if (sources.length === 0) {
        // Never return zero sources purely because the single best match ran long — truncate it
        // instead (head+tail, via the same clamp P3's enrichment path uses).
        const remainingBudget = Math.max(0, budget - usedTokens)
        const { text: clipped } = truncateToTokenBudget(bodyText, remainingBudget)
        const index = sources.length + 1
        sources.push(toSource(index, item))
        contextBlocks.push({ index, text: formatBlock(index, item, clipped) })
        usedTokens += estimateTokens(clipped)
        for (const chunk of item.chunks) retrievedChunks.push(logEntry(item, chunk, true))
      } else {
        for (const chunk of item.chunks) retrievedChunks.push(logEntry(item, chunk, false))
      }
      truncated = true
      stoppedAtIndex = position
      return
    }

    const index = sources.length + 1
    sources.push(toSource(index, item))
    contextBlocks.push({ index, text: formatBlock(index, item, bodyText) })
    usedTokens += itemTokens
    for (const chunk of item.chunks) retrievedChunks.push(logEntry(item, chunk, true))
  })

  return { sources, contextBlocks, retrievedChunks, truncated }
}

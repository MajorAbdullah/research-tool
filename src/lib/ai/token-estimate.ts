/**
 * A rough, dependency-free token-count heuristic — NOT a real tokenizer. Good enough for the two
 * things this codebase uses it for: deciding whether content overflows a context window (the
 * long-content router) and sizing chunks to "~500 tokens" (the embeddings chunker). Both only need
 * an estimate within a safety margin, not an exact BPE count, and pulling in a real tokenizer
 * (`tiktoken`/`js-tiktoken`) per-model would be its own maintenance burden for free models whose
 * exact tokenizers aren't published.
 *
 * ~4 characters/token is the commonly-cited average for English text; used consistently across
 * `src/lib/ai/**` and `src/lib/embeddings/**` so a "budget" means the same thing everywhere.
 */
const CHARS_PER_TOKEN = 4

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** Inverse of `estimateTokens` — how many characters a token budget affords. Kept next to it so
 *  the two never drift onto different ratios. */
export function tokenBudgetToChars(maxTokens: number): number {
  return Math.max(0, maxTokens) * CHARS_PER_TOKEN
}

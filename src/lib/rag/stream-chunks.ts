/**
 * Splits a finished answer into small pieces for progressive SSE delivery.
 *
 * `LLMProvider.complete()` (src/lib/ai/provider.ts, frozen for this phase — CLAUDE.md's file
 * ownership) resolves with the whole answer at once: OpenRouter's chat-completions call is
 * non-streaming under the hood (`openrouter-client.ts`'s `callChatCompletion` does a single
 * `res.json()`), and this phase's scope explicitly excludes changing `src/lib/ai/**`. True
 * token-by-token delivery from the model therefore isn't available here. This is the honest
 * alternative: split the finished answer into small, whitespace-exact pieces and flush each as
 * its own `event: token` frame, so the SSE transport and the client's progressive rendering are
 * both real, even though the underlying generation call itself resolves in one shot rather than
 * streaming. See the final report for the latency consequence this has for "first token < 2s".
 */

const WORDS_PER_CHUNK = 6

/** `chunks.join('') === text` always holds — whitespace is kept attached to its preceding word
 *  rather than trimmed, so rejoining the stream client-side needs no extra space-insertion logic. */
export function splitIntoStreamChunks(text: string): string[] {
  if (text.length === 0) return []
  const pieces = text.split(/(\s+)/)
  const chunks: string[] = []
  let buffer = ''
  let wordCount = 0

  for (const piece of pieces) {
    if (piece.length === 0) continue
    buffer += piece
    if (piece.trim().length > 0) wordCount++
    if (wordCount >= WORDS_PER_CHUNK) {
      chunks.push(buffer)
      buffer = ''
      wordCount = 0
    }
  }
  if (buffer.length > 0) chunks.push(buffer)
  return chunks
}

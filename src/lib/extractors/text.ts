/**
 * Every extractor's contentText is untrusted content that is later fed to an LLM (P3). Capping
 * length here is defense-in-depth against a single pathological page/transcript/PDF blowing up
 * prompt size or memory — it is not a substitute for the prompt-injection delimiting P3 owns (see
 * CLAUDE.md, "Prompt Injection").
 */
export const MAX_CONTENT_CHARS = 20_000

export function capText(text: string, maxChars: number = MAX_CONTENT_CHARS): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars)}\n\n[truncated — original was ${trimmed.length} characters]`
}

/**
 * Prompt construction for the chat/RAG turn. Loads the system prompt from `prompts/` (versioned
 * file, never an inline string — CLAUDE.md/genai-best-practices) and assembles the user-turn
 * message from the already-delimited context blocks `context-assembly.ts` produced.
 */

import type { LLMMessage } from '@/types/contracts'
import { loadPrompt } from '@/lib/ai'
import type { ChatFilters, ContextBlock, ConversationTurn } from './types'

const CHAT_SYSTEM_PROMPT_FILE = 'chat.v1.md'
const CITATION_RETRY_PROMPT_FILE = 'chat-citation-retry.v1.md'

/** Prior turns are capped, not replayed in full — a long-running conversation must not grow the
 *  prompt without bound. Text only (see types.ts's `ConversationTurn` doc): each turn's own
 *  retrieved context is never replayed, only the fresh retrieval for the CURRENT question. */
const MAX_HISTORY_TURNS = 8

function describeScope(filters: ChatFilters | undefined): string | null {
  if (!filters || (!filters.kind && !filters.topic)) return null
  const parts: string[] = []
  if (filters.kind) parts.push(`kind = ${filters.kind}`)
  if (filters.topic) parts.push(`topic = ${filters.topic}`)
  return `(Scope filter applied: ${parts.join(', ')} — the sources below are already limited to it.)`
}

export interface BuildChatMessagesInput {
  question: string
  contextBlocks: ContextBlock[]
  history?: ConversationTurn[]
  filters?: ChatFilters
}

export interface PromptMeta {
  version: string
}

export function buildChatMessages(input: BuildChatMessagesInput): {
  messages: LLMMessage[]
  meta: PromptMeta
} {
  const system = loadPrompt(CHAT_SYSTEM_PROMPT_FILE)

  const messages: LLMMessage[] = [{ role: 'system', content: system.content }]

  const recentHistory = (input.history ?? []).slice(-MAX_HISTORY_TURNS)
  for (const turn of recentHistory) {
    messages.push({ role: turn.role, content: turn.content })
  }

  const scopeLine = describeScope(input.filters)
  const userParts = [
    scopeLine,
    ...input.contextBlocks.map((block) => block.text),
    `Question: ${input.question}`,
  ].filter((part): part is string => part !== null && part.length > 0)

  messages.push({ role: 'user', content: userParts.join('\n\n') })

  return { messages, meta: { version: system.version } }
}

/** Appends the corrective-retry turn (P13.2: "an uncited claim triggers one corrective retry")
 *  onto an already-attempted exchange, for a second `provider.complete()` call. */
export function buildCitationRetryMessages(
  previousMessages: LLMMessage[],
  previousAnswer: string,
): LLMMessage[] {
  const retry = loadPrompt(CITATION_RETRY_PROMPT_FILE)
  return [
    ...previousMessages,
    { role: 'assistant', content: previousAnswer },
    { role: 'user', content: retry.content },
  ]
}

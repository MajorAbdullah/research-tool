/**
 * Conversation history (P13.6): `conversations` + `chat_messages` persistence. `POST /api/v1/chat`
 * only ever receives the latest `message` plus an optional `conversation_id` (docs/API.md §3.8) —
 * this module is what turns that into "the last few turns of real context," server-side, and what
 * records every assistant turn's citations/groundedness/retrieved-chunk log for later diagnosis.
 */

import type Database from 'better-sqlite3'
import { toConversationWireId, parseConversationWireId, toMessageWireId } from './ids'
import type { ChatSource, ConversationTurn, RetrievedChunkLogEntry } from './types'

export interface ConversationHandle {
  id: number
  wireId: string
}

/**
 * Resolves an existing conversation (re-validating it belongs to `userId`, same
 * indistinguishable-404 spirit as `NOT_FOUND` elsewhere in this API — CLAUDE.md's scoping rule) or
 * creates a new one. A stale, foreign, or malformed `conversation_id` silently starts a fresh
 * conversation rather than erroring — a chat client's locally-remembered id going stale (e.g. the
 * conversation was on another device) shouldn't hard-fail the next message.
 */
export function getOrCreateConversation(
  sqlite: Database.Database,
  userId: number,
  conversationWireId: string | undefined,
  firstMessage: string,
): ConversationHandle {
  if (conversationWireId) {
    const id = parseConversationWireId(conversationWireId)
    if (id !== null) {
      const row = sqlite
        .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
        .get(id, userId) as { id: number } | undefined
      if (row) return { id: row.id, wireId: toConversationWireId(row.id) }
    }
  }

  const title = firstMessage.trim().slice(0, 120)
  const now = Date.now()
  const info = sqlite
    .prepare(
      'INSERT INTO conversations (user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    )
    .run(userId, title, now, now)
  const id = Number(info.lastInsertRowid)
  return { id, wireId: toConversationWireId(id) }
}

/** Raw rows kept generously above `prompt.ts`'s `MAX_HISTORY_TURNS` — history is capped again,
 *  more tightly, at prompt-build time; this is just "don't scan the whole conversation table." */
const MAX_HISTORY_ROWS = 24

/** Oldest-first, ready to splice directly into the next turn's message array. */
export function loadHistory(
  sqlite: Database.Database,
  userId: number,
  conversationId: number,
): ConversationTurn[] {
  const rows = sqlite
    .prepare(
      `SELECT role, content FROM chat_messages
        WHERE conversation_id = ? AND user_id = ?
        ORDER BY id DESC LIMIT ?`,
    )
    .all(conversationId, userId, MAX_HISTORY_ROWS) as ConversationTurn[]
  return rows.reverse()
}

export interface AppendUserMessageInput {
  conversationId: number
  userId: number
  content: string
}

export function appendUserMessage(
  sqlite: Database.Database,
  input: AppendUserMessageInput,
): number {
  const info = sqlite
    .prepare(
      `INSERT INTO chat_messages (conversation_id, user_id, role, content, created_at)
       VALUES (?, ?, 'user', ?, ?)`,
    )
    .run(input.conversationId, input.userId, input.content, Date.now())
  return Number(info.lastInsertRowid)
}

export interface AppendAssistantMessageInput {
  conversationId: number
  userId: number
  content: string
  sources: ChatSource[]
  grounded: boolean
  retrievedChunks: RetrievedChunkLogEntry[]
}

/** Also bumps `conversations.updated_at` — the natural "a turn just completed" point. */
export function appendAssistantMessage(
  sqlite: Database.Database,
  input: AppendAssistantMessageInput,
): number {
  const now = Date.now()
  const info = sqlite
    .prepare(
      `INSERT INTO chat_messages
         (conversation_id, user_id, role, content, sources, grounded, retrieved_chunks, created_at)
       VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`,
    )
    .run(
      input.conversationId,
      input.userId,
      input.content,
      JSON.stringify(input.sources),
      input.grounded ? 1 : 0,
      JSON.stringify(input.retrievedChunks),
      now,
    )
  sqlite
    .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
    .run(now, input.conversationId)
  return Number(info.lastInsertRowid)
}

export { toConversationWireId, toMessageWireId }

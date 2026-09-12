import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, type TestDb } from '../../helpers/db'
import { makeUser } from '../../helpers/factories'
import {
  getOrCreateConversation,
  loadHistory,
  appendUserMessage,
  appendAssistantMessage,
} from '@/lib/rag/conversation-store'

describe('getOrCreateConversation', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeTestDb()
    makeUser(db, 1)
    makeUser(db, 2)
  })
  afterEach(() => db.close())

  it('creates a new conversation when no id is given', () => {
    const handle = getOrCreateConversation(db, 1, undefined, 'what did I save about attention?')
    expect(handle.wireId).toMatch(/^cnv_\d+$/)

    const row = db
      .prepare('SELECT title, user_id FROM conversations WHERE id = ?')
      .get(handle.id) as {
      title: string
      user_id: number
    }
    expect(row.title).toBe('what did I save about attention?')
    expect(row.user_id).toBe(1)
  })

  it('resolves an existing conversation id back to the same conversation', () => {
    const first = getOrCreateConversation(db, 1, undefined, 'first question')
    const second = getOrCreateConversation(db, 1, first.wireId, 'second question')
    expect(second.id).toBe(first.id)
  })

  it('starts a fresh conversation for a malformed conversation_id rather than erroring', () => {
    const handle = getOrCreateConversation(db, 1, 'not-a-real-id', 'question')
    expect(handle.wireId).toMatch(/^cnv_\d+$/)
  })

  it('starts a fresh conversation when the id belongs to another user (indistinguishable from stale)', () => {
    const other = getOrCreateConversation(db, 2, undefined, "user 2's conversation")
    const mine = getOrCreateConversation(db, 1, other.wireId, 'my question')
    expect(mine.id).not.toBe(other.id)
  })
})

describe('history + message persistence', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeTestDb()
    makeUser(db, 1)
  })
  afterEach(() => db.close())

  it('loadHistory is empty for a brand new conversation', () => {
    const conv = getOrCreateConversation(db, 1, undefined, 'q')
    expect(loadHistory(db, 1, conv.id)).toEqual([])
  })

  it('returns turns oldest-first, in the order they were appended', () => {
    const conv = getOrCreateConversation(db, 1, undefined, 'q1')
    appendUserMessage(db, { conversationId: conv.id, userId: 1, content: 'q1' })
    appendAssistantMessage(db, {
      conversationId: conv.id,
      userId: 1,
      content: 'a1 [1].',
      sources: [],
      grounded: true,
      retrievedChunks: [],
    })
    appendUserMessage(db, { conversationId: conv.id, userId: 1, content: 'q2' })

    const history = loadHistory(db, 1, conv.id)
    expect(history.map((h) => h.content)).toEqual(['q1', 'a1 [1].', 'q2'])
    expect(history.map((h) => h.role)).toEqual(['user', 'assistant', 'user'])
  })

  it('persists sources/grounded/retrievedChunks as real JSON, round-trippable', () => {
    const conv = getOrCreateConversation(db, 1, undefined, 'q')
    const messageId = appendAssistantMessage(db, {
      conversationId: conv.id,
      userId: 1,
      content: 'answer [1].',
      sources: [
        {
          index: 1,
          itemId: 9,
          wireId: 'itm_9',
          title: 't',
          kind: 'github',
          canonicalUrl: 'https://x',
        },
      ],
      grounded: true,
      retrievedChunks: [
        {
          itemId: 9,
          chunkId: 3,
          ord: 0,
          ftsRank: -1,
          vectorDistance: 0.2,
          fusedScore: 0.03,
          includedInContext: true,
        },
      ],
    })

    const row = db
      .prepare('SELECT sources, grounded, retrieved_chunks FROM chat_messages WHERE id = ?')
      .get(messageId) as { sources: string; grounded: number; retrieved_chunks: string }

    expect(JSON.parse(row.sources)).toHaveLength(1)
    expect(row.grounded).toBe(1)
    expect(JSON.parse(row.retrieved_chunks)).toHaveLength(1)
  })

  it('bumps conversations.updated_at when an assistant message is appended', () => {
    const conv = getOrCreateConversation(db, 1, undefined, 'q')
    const before = (
      db.prepare('SELECT updated_at FROM conversations WHERE id = ?').get(conv.id) as {
        updated_at: number
      }
    ).updated_at

    appendAssistantMessage(db, {
      conversationId: conv.id,
      userId: 1,
      content: 'a',
      sources: [],
      grounded: false,
      retrievedChunks: [],
    })

    const after = (
      db.prepare('SELECT updated_at FROM conversations WHERE id = ?').get(conv.id) as {
        updated_at: number
      }
    ).updated_at
    expect(after).toBeGreaterThanOrEqual(before)
  })
})

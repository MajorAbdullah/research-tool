import { describe, expect, it } from 'vitest'
import { buildChatMessages, buildCitationRetryMessages } from '@/lib/rag/prompt'
import type { ContextBlock, ConversationTurn } from '@/lib/rag/types'

const CONTEXT_BLOCKS: ContextBlock[] = [
  {
    index: 1,
    text: 'Source [1]: "vllm"\n<untrusted_content>\nPagedAttention details\n</untrusted_content>',
  },
]

describe('buildChatMessages', () => {
  it('puts the loaded system prompt first, then history, then the new user turn', () => {
    const history: ConversationTurn[] = [
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer [1].' },
    ]

    const { messages, meta } = buildChatMessages({
      question: 'What did I save about attention mechanisms?',
      contextBlocks: CONTEXT_BLOCKS,
      history,
    })

    expect(messages[0]?.role).toBe('system')
    expect(messages[0]?.content.length).toBeGreaterThan(0)
    expect(messages[1]).toEqual(history[0])
    expect(messages[2]).toEqual(history[1])
    const last = messages[messages.length - 1]
    expect(last?.role).toBe('user')
    expect(last?.content).toContain('PagedAttention details')
    expect(last?.content).toContain('What did I save about attention mechanisms?')
    expect(meta.version).toMatch(/^v\d+$/)
  })

  it('never inlines the delimited context into the system message', () => {
    const { messages } = buildChatMessages({ question: 'q', contextBlocks: CONTEXT_BLOCKS })
    const system = messages.find((m) => m.role === 'system')
    expect(system?.content).not.toContain('PagedAttention details')
  })

  it('mentions the active scope filter in the user turn when one is set', () => {
    const { messages } = buildChatMessages({
      question: 'q',
      contextBlocks: CONTEXT_BLOCKS,
      filters: { kind: 'github' },
    })
    const user = messages[messages.length - 1]
    expect(user?.content).toContain('kind = github')
  })

  it('says nothing about scope when no filter is set', () => {
    const { messages } = buildChatMessages({ question: 'q', contextBlocks: CONTEXT_BLOCKS })
    const user = messages[messages.length - 1]
    expect(user?.content).not.toContain('Scope filter')
  })

  it('caps replayed history to a bounded number of recent turns', () => {
    const longHistory: ConversationTurn[] = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `turn ${i}`,
    }))

    const { messages } = buildChatMessages({
      question: 'q',
      contextBlocks: CONTEXT_BLOCKS,
      history: longHistory,
    })

    // system + capped history + final user turn — strictly fewer messages than 1 + history.length + 1
    expect(messages.length).toBeLessThan(2 + longHistory.length)
  })
})

describe('buildCitationRetryMessages', () => {
  it('appends the prior answer as an assistant turn, then a corrective user turn', () => {
    const original: ContextBlock[] = CONTEXT_BLOCKS
    const { messages } = buildChatMessages({ question: 'q', contextBlocks: original })

    const retryMessages = buildCitationRetryMessages(messages, 'an uncited claim')

    expect(retryMessages.slice(0, messages.length)).toEqual(messages)
    expect(retryMessages[messages.length]).toEqual({
      role: 'assistant',
      content: 'an uncited claim',
    })
    const last = retryMessages[retryMessages.length - 1]
    expect(last?.role).toBe('user')
    expect(last?.content.length).toBeGreaterThan(0)
  })
})

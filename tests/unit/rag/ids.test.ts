import { describe, expect, it } from 'vitest'
import {
  parseItemWireId,
  toConversationWireId,
  parseConversationWireId,
  toMessageWireId,
} from '@/lib/rag/ids'

describe('item wire ids', () => {
  it('parses a well-formed itm_ id back to its numeric row id', () => {
    expect(parseItemWireId('itm_42')).toBe(42)
  })

  it.each(['itm_0', 'itm_', 'itm_abc', 'foo_42', '42', 'itm_01', 'itm_-1'])(
    'rejects a malformed id: %s',
    (id) => {
      expect(parseItemWireId(id)).toBeNull()
    },
  )
})

describe('conversation wire ids', () => {
  it('round-trips through the exact same shape item ids use (cnv_ prefix, digits)', () => {
    expect(toConversationWireId(7)).toBe('cnv_7')
    expect(parseConversationWireId('cnv_7')).toBe(7)
  })

  it('returns null for a stale/foreign/malformed conversation id — never throws', () => {
    expect(parseConversationWireId('itm_7')).toBeNull()
    expect(parseConversationWireId('cnv_')).toBeNull()
    expect(parseConversationWireId('not-an-id')).toBeNull()
  })
})

describe('message wire ids', () => {
  it('formats with the msg_ prefix', () => {
    expect(toMessageWireId(99)).toBe('msg_99')
  })
})

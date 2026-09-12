import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseWhatsAppChat } from '../../../src/lib/importers/chat-parser'
import {
  buildCandidates,
  countByKind,
  dedupeCandidates,
} from '../../../src/lib/importers/candidates'

const FIXTURES_DIR = fileURLToPath(new URL('../../fixtures/whatsapp/', import.meta.url))

function readFixture(name: string): string {
  return readFileSync(`${FIXTURES_DIR}${name}`, 'utf-8')
}

describe('parseWhatsAppChat - iOS fixture (ios-basic.txt)', () => {
  const text = readFixture('ios-basic.txt')
  const result = parseWhatsAppChat(text)

  it('parses exactly 9 messages with zero skipped lines', () => {
    expect(result.messages).toHaveLength(9)
    expect(result.skipped).toHaveLength(0)
  })

  it('detects the iOS bracket format', () => {
    expect(result.sourceFormat).toBe('ios')
  })

  it('infers DD/MM order with certainty from the day=13 line', () => {
    expect(result.dateFormat).toEqual({ order: 'DMY', confidence: 'certain' })
  })

  it('classifies exactly 2 system lines (no author) and 7 authored messages', () => {
    expect(result.messages.filter((m) => m.isSystem)).toHaveLength(2)
    expect(result.messages.filter((m) => !m.isSystem)).toHaveLength(7)
  })

  it('never attributes an author to the encryption notice or the join notice', () => {
    const encryptionNotice = result.messages.find((m) => m.text.includes('end-to-end encrypted'))
    const joinNotice = result.messages.find((m) => m.text.includes('joined using'))
    expect(encryptionNotice?.author).toBeNull()
    expect(joinNotice?.author).toBeNull()
  })

  it('converts 12:00:00 AM to midnight (hour 0)', () => {
    const midnight = result.messages.find((m) => m.text.includes('midnight-link'))
    expect(midnight?.timestampMs).toBe(Date.UTC(2026, 8, 1, 0, 0, 0))
  })

  it('converts 12:00:00 PM to noon (hour 12)', () => {
    const noon = result.messages.find((m) => m.text.includes('noon-link'))
    expect(noon?.timestampMs).toBe(Date.UTC(2026, 8, 1, 12, 0, 0))
  })

  it('parses the day=13 message at the expected timestamp', () => {
    const msg = result.messages.find((m) => m.text.includes('unambiguous-day'))
    expect(msg?.timestampMs).toBe(Date.UTC(2026, 8, 13, 15, 22, 15))
  })

  it('extracts exactly 6 links total, deduping to 6 unique candidates across 5 kinds', () => {
    const candidates = buildCandidates(result)
    expect(candidates).toHaveLength(6)
    const { unique, duplicateCount } = dedupeCandidates(candidates)
    expect(unique).toHaveLength(6)
    expect(duplicateCount).toBe(0)
    expect(countByKind(unique)).toEqual({
      github: 1,
      video: 0,
      article: 4,
      social: 0,
      pdf: 1,
      other: 0,
    })
  })

  it('keeps <Media omitted> as a real authored message with zero links', () => {
    const mediaMsg = result.messages.find((m) => m.text.includes('<Media omitted>'))
    expect(mediaMsg).toBeDefined()
    expect(mediaMsg?.author).toBe('Imran Aziz')
    expect(buildCandidates({ ...result, messages: [mediaMsg!] })).toHaveLength(0)
  })
})

describe('parseWhatsAppChat - Android fixture (android-basic.txt)', () => {
  const text = readFixture('android-basic.txt')
  const result = parseWhatsAppChat(text)

  it('parses exactly 10 messages with zero skipped lines', () => {
    expect(result.messages).toHaveLength(10)
    expect(result.skipped).toHaveLength(0)
  })

  it('detects the Android dash format', () => {
    expect(result.sourceFormat).toBe('android')
  })

  it('infers DD/MM order with certainty from the day=21 line', () => {
    expect(result.dateFormat).toEqual({ order: 'DMY', confidence: 'certain' })
  })

  it('classifies exactly 3 system lines (encrypted/joined/left) and 7 authored messages', () => {
    expect(result.messages.filter((m) => m.isSystem)).toHaveLength(3)
    expect(result.messages.filter((m) => !m.isSystem)).toHaveLength(7)
  })

  it('does not mis-split "Sana Khan left" as an author (no colon present)', () => {
    const leftMsg = result.messages.find((m) => m.text === 'Sana Khan left')
    expect(leftMsg?.author).toBeNull()
  })

  it('expands a 2-digit year to 2026 and parses 24-hour clock edges (00:00 and 23:59)', () => {
    const midnight = result.messages.find((m) => m.text.includes('y2k-ish'))
    const endOfDay = result.messages.find((m) => m.text.includes('eod'))
    expect(midnight?.timestampMs).toBe(Date.UTC(2026, 8, 7, 0, 0, 0))
    expect(endOfDay?.timestampMs).toBe(Date.UTC(2026, 8, 7, 23, 59, 0))
  })

  it('extracts exactly 6 links total, all unique, across video/social/article', () => {
    const candidates = buildCandidates(result)
    expect(candidates).toHaveLength(6)
    const { unique, duplicateCount } = dedupeCandidates(candidates)
    expect(unique).toHaveLength(6)
    expect(duplicateCount).toBe(0)
    expect(countByKind(unique)).toEqual({
      github: 0,
      video: 1,
      article: 4,
      social: 1,
      pdf: 0,
      other: 0,
    })
  })
})

describe('parseWhatsAppChat - RTL/multi-line/mixed-kind fixture (rtl-multiline-mixed.txt)', () => {
  const text = readFixture('rtl-multiline-mixed.txt')
  const result = parseWhatsAppChat(text)

  it('parses exactly 10 messages with zero skipped lines despite embedded LRM/RLM marks', () => {
    expect(result.messages).toHaveLength(10)
    expect(result.skipped).toHaveLength(0)
  })

  it('infers DD/MM with certainty and detects the iOS bracket format', () => {
    expect(result.sourceFormat).toBe('ios')
    expect(result.dateFormat).toEqual({ order: 'DMY', confidence: 'certain' })
  })

  it('classifies exactly 4 system lines and 6 authored messages', () => {
    expect(result.messages.filter((m) => m.isSystem)).toHaveLength(4)
    expect(result.messages.filter((m) => !m.isSystem)).toHaveLength(6)
  })

  it('joins the 3-line multi-line message into one message with both of its links', () => {
    const msg = result.messages.find((m) => m.text.startsWith('Sharing a few things'))
    expect(msg).toBeDefined()
    expect(msg?.author).toBe('John Appleseed')
    expect(msg?.text.split('\n')).toHaveLength(3)
    expect(buildCandidates({ ...result, messages: [msg!] }).map((c) => c.url)).toEqual([
      'https://github.com/anthropics/claude-code',
      'https://youtu.be/dQw4w9WgXcQ',
    ])
  })

  it('strips the RLM before a pasted instagram link cleanly', () => {
    const msg = result.messages.find((m) => m.text.includes('instagram'))
    const urls = buildCandidates({ ...result, messages: [msg!] }).map((c) => c.url)
    expect(urls).toEqual(['https://www.instagram.com/reel/CxAmpleReel123/'])
  })

  it('parses the narrow-NBSP + LRM wedged PM marker correctly (23:59:00, not a parse failure)', () => {
    const msg = result.messages.find((m) => m.text.includes('paper link'))
    expect(msg?.timestampMs).toBe(Date.UTC(2026, 8, 14, 23, 59, 0))
  })

  it('never attributes an author to the join/left/encryption/security-code system lines', () => {
    for (const needle of ['end-to-end encrypted', 'joined using', 'security code']) {
      const msg = result.messages.find((m) => m.text.includes(needle))
      expect(msg?.author, `expected "${needle}" to have no author`).toBeNull()
    }
  })

  it('finds exactly 7 raw link occurrences, deduping the repeated github link to 6 uniques across 5 kinds', () => {
    const candidates = buildCandidates(result)
    expect(candidates).toHaveLength(7)
    const { unique, duplicateCount } = dedupeCandidates(candidates)
    expect(duplicateCount).toBe(1)
    expect(unique).toHaveLength(6)
    expect(countByKind(unique)).toEqual({
      github: 1,
      video: 1,
      article: 2,
      social: 1,
      pdf: 1,
      other: 0,
    })
  })

  it('trims an unbalanced trailing paren but keeps a balanced one', () => {
    const viaFriend = result.messages.find((m) => m.text.includes('via a friend'))
    expect(buildCandidates({ ...result, messages: [viaFriend!] }).map((c) => c.url)).toEqual([
      'https://example.com/via-friend',
    ])
    const wiki = result.messages.find((m) => m.text.includes('Bidirectional_text'))
    expect(buildCandidates({ ...result, messages: [wiki!] }).map((c) => c.url)).toEqual([
      'https://en.wikipedia.org/wiki/Bidirectional_text_(computing)',
    ])
  })
})

describe('parseWhatsAppChat - edge cases fixture (unparseable-edgecases.txt)', () => {
  const text = readFixture('unparseable-edgecases.txt')
  const result = parseWhatsAppChat(text)

  it('parses exactly 3 valid messages and skips exactly 2 lines', () => {
    expect(result.messages).toHaveLength(3)
    expect(result.skipped).toHaveLength(2)
  })

  it('never throws, and every skipped line carries a non-empty reason', () => {
    for (const s of result.skipped) {
      expect(typeof s.reason).toBe('string')
      expect(s.reason.length).toBeGreaterThan(0)
    }
  })

  it('flags leading preamble text (before any header) with the correct reason', () => {
    const preamble = result.skipped.find((s) => s.raw.includes('corrupted export preamble'))
    expect(preamble).toBeDefined()
    expect(preamble?.reason).toContain('before any recognized message header')
    expect(preamble?.lineNumber).toBe(1)
  })

  it('flags the impossible 99/99/2026 date as an invalid header, not a valid message', () => {
    const badHeader = result.skipped.find((s) => s.raw.includes('99/99/2026'))
    expect(badHeader).toBeDefined()
    expect(badHeader?.reason).toContain('invalid date/time in timestamp header')
    expect(result.messages.some((m) => m.text.includes('impossible'))).toBe(false)
  })

  it('still parses the valid messages surrounding the bad lines correctly', () => {
    expect(result.messages.map((m) => m.author)).toEqual(['Sana Khan', 'Imran Aziz', 'Sana Khan'])
  })

  it('treats a trailing non-header line as a continuation, not a skip - and still finds its link', () => {
    const third = result.messages[2]!
    expect(third.text).toContain('one more thought before I forget')
    const urls = buildCandidates({ ...result, messages: [third] }).map((c) => c.url)
    expect(urls).toEqual(['https://example.com/third', 'https://example.com/fourth'])
  })

  it('extracts exactly 4 links total, all unique', () => {
    const candidates = buildCandidates(result)
    expect(candidates).toHaveLength(4)
    const { unique, duplicateCount } = dedupeCandidates(candidates)
    expect(unique).toHaveLength(4)
    expect(duplicateCount).toBe(0)
  })
})

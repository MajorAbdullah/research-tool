import { describe, expect, it } from 'vitest'
import {
  buildCandidates,
  countByKind,
  dedupeCandidates,
  emptyKindCounts,
} from '../../../src/lib/importers/candidates'
import { computeUrlHash } from '../../../src/lib/importers/url-hash'
import type { ChatParseResult, ImportLinkCandidate } from '../../../src/lib/importers/types'

function parseResult(overrides: Partial<ChatParseResult> = {}): ChatParseResult {
  return {
    messages: [],
    skipped: [],
    sourceFormat: 'ios',
    dateFormat: { order: 'DMY', confidence: 'certain' },
    ...overrides,
  }
}

describe('buildCandidates', () => {
  it('produces one candidate per URL, all sharing the same note and timestamp', () => {
    const parsed = parseResult({
      messages: [
        {
          lineNumber: 3,
          timestampMs: 1_000,
          author: 'Sana Khan',
          text: 'repo https://github.com/a/b and article https://example.com/x',
          isSystem: false,
        },
      ],
    })
    const candidates = buildCandidates(parsed)
    expect(candidates).toHaveLength(2)
    expect(candidates.map((c) => c.url)).toEqual([
      'https://github.com/a/b',
      'https://example.com/x',
    ])
    for (const c of candidates) {
      expect(c.createdAt).toBe(1_000)
      expect(c.author).toBe('Sana Khan')
      expect(c.note).toBe('repo https://github.com/a/b and article https://example.com/x')
      expect(c.sourceLineNumber).toBe(3)
    }
    expect(candidates[0]!.kind).toBe('github')
    expect(candidates[1]!.kind).toBe('article')
  })

  it('produces no candidates for a message with no URL', () => {
    const parsed = parseResult({
      messages: [{ lineNumber: 1, timestampMs: 0, author: 'A', text: 'just chatting', isSystem: false }],
    })
    expect(buildCandidates(parsed)).toHaveLength(0)
  })
})

describe('dedupeCandidates', () => {
  function candidate(url: string, note = 'note'): ImportLinkCandidate {
    return {
      url,
      urlHash: computeUrlHash(url),
      kind: 'other',
      createdAt: 0,
      note,
      author: null,
      sourceLineNumber: 1,
    }
  }

  it('drops repeats within the same file, keeping the first occurrence', () => {
    const candidates = [candidate('https://example.com/a'), candidate('https://example.com/a')]
    const { unique, duplicateCount } = dedupeCandidates(candidates)
    expect(unique).toHaveLength(1)
    expect(duplicateCount).toBe(1)
  })

  it('drops candidates already present in existingUrlHashes', () => {
    const existing = new Set([computeUrlHash('https://example.com/a')])
    const candidates = [candidate('https://example.com/a'), candidate('https://example.com/b')]
    const { unique, duplicateCount } = dedupeCandidates(candidates, existing)
    expect(unique.map((c) => c.url)).toEqual(['https://example.com/b'])
    expect(duplicateCount).toBe(1)
  })

  it('is a full no-op when every candidate already exists (re-importing the same export)', () => {
    const candidates = [candidate('https://example.com/a'), candidate('https://example.com/b')]
    const existing = new Set(candidates.map((c) => c.urlHash))
    const { unique, duplicateCount } = dedupeCandidates(candidates, existing)
    expect(unique).toHaveLength(0)
    expect(duplicateCount).toBe(2)
  })

  it('keeps everything when there are no duplicates at all', () => {
    const candidates = [candidate('https://example.com/a'), candidate('https://example.com/b')]
    const { unique, duplicateCount } = dedupeCandidates(candidates)
    expect(unique).toHaveLength(2)
    expect(duplicateCount).toBe(0)
  })
})

describe('countByKind / emptyKindCounts', () => {
  it('includes every kind at 0 even when absent', () => {
    expect(emptyKindCounts()).toEqual({
      github: 0,
      video: 0,
      article: 0,
      social: 0,
      pdf: 0,
      other: 0,
    })
  })

  it('tallies candidates by kind', () => {
    const candidates: ImportLinkCandidate[] = [
      { url: 'a', urlHash: '1', kind: 'github', createdAt: 0, note: '', author: null, sourceLineNumber: 1 },
      { url: 'b', urlHash: '2', kind: 'github', createdAt: 0, note: '', author: null, sourceLineNumber: 2 },
      { url: 'c', urlHash: '3', kind: 'video', createdAt: 0, note: '', author: null, sourceLineNumber: 3 },
    ]
    expect(countByKind(candidates)).toEqual({
      github: 2,
      video: 1,
      article: 0,
      social: 0,
      pdf: 0,
      other: 0,
    })
  })
})

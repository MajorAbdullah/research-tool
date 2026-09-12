import { describe, expect, it } from 'vitest'
import { assembleContext, DEFAULT_CONTEXT_TOKEN_BUDGET } from '@/lib/rag/context-assembly'
import type { CandidateItem } from '@/lib/rag/types'

function item(
  overrides: Partial<CandidateItem> & Pick<CandidateItem, 'itemId' | 'chunks'>,
): CandidateItem {
  return {
    wireId: `itm_${overrides.itemId}`,
    title: `Item ${overrides.itemId}`,
    kind: 'article',
    canonicalUrl: `https://example.test/${overrides.itemId}`,
    fusedScore: 0.01,
    ...overrides,
  }
}

describe('assembleContext — source order and citation numbering', () => {
  it('assigns citation indices in the caller-supplied (relevance) order, 1-based', () => {
    const items: CandidateItem[] = [
      item({
        itemId: 1,
        chunks: [
          { chunkId: 10, ord: 0, text: 'first item body', ftsRank: null, vectorDistance: 0.5 },
        ],
      }),
      item({
        itemId: 2,
        chunks: [
          { chunkId: 20, ord: 0, text: 'second item body', ftsRank: null, vectorDistance: 0.6 },
        ],
      }),
    ]

    const result = assembleContext(items)

    expect(result.sources.map((s) => s.index)).toEqual([1, 2])
    expect(result.sources.map((s) => s.itemId)).toEqual([1, 2])
    expect(result.contextBlocks.map((b) => b.index)).toEqual([1, 2])
  })

  it('joins a multi-chunk item in ORD order, not the order chunks happen to be passed in', () => {
    const items: CandidateItem[] = [
      item({
        itemId: 1,
        chunks: [
          {
            chunkId: 12,
            ord: 2,
            text: 'THIRD sentence of the transcript.',
            ftsRank: null,
            vectorDistance: 0.4,
          },
          {
            chunkId: 10,
            ord: 0,
            text: 'FIRST sentence of the transcript.',
            ftsRank: null,
            vectorDistance: 0.4,
          },
          {
            chunkId: 11,
            ord: 1,
            text: 'SECOND sentence of the transcript.',
            ftsRank: null,
            vectorDistance: 0.4,
          },
        ],
      }),
    ]

    const result = assembleContext(items)
    const block = result.contextBlocks[0]
    expect(block).toBeDefined()

    const firstIdx = block!.text.indexOf('FIRST')
    const secondIdx = block!.text.indexOf('SECOND')
    const thirdIdx = block!.text.indexOf('THIRD')
    expect(firstIdx).toBeGreaterThanOrEqual(0)
    expect(firstIdx).toBeLessThan(secondIdx)
    expect(secondIdx).toBeLessThan(thirdIdx)
  })

  it('delimits every source as untrusted content and labels it with its citation number', () => {
    const items: CandidateItem[] = [
      item({
        itemId: 7,
        title: 'vllm-project/vllm',
        kind: 'github',
        chunks: [{ chunkId: 1, ord: 0, text: 'body text', ftsRank: null, vectorDistance: null }],
      }),
    ]

    const result = assembleContext(items)
    const text = result.contextBlocks[0]!.text
    expect(text).toContain('<untrusted_content>')
    expect(text).toContain('</untrusted_content>')
    expect(text).toContain('Source [1]')
    expect(text).toContain('vllm-project/vllm')
    expect(text).toContain('body text')
  })

  it('logs every chunk of every candidate item, included or not', () => {
    const items: CandidateItem[] = [
      item({
        itemId: 1,
        chunks: [{ chunkId: 10, ord: 0, text: 'a', ftsRank: -1, vectorDistance: 0.5 }],
      }),
      item({
        itemId: 2,
        chunks: [{ chunkId: 20, ord: 0, text: 'b', ftsRank: null, vectorDistance: 0.9 }],
      }),
    ]
    const result = assembleContext(items)
    expect(result.retrievedChunks).toHaveLength(2)
    expect(result.retrievedChunks.every((c) => c.includedInContext)).toBe(true)
  })
})

describe('assembleContext — token budget', () => {
  it('truncates rather than drops the single best item when it alone exceeds the budget', () => {
    const hugeText = 'word '.repeat(20_000) // way over any reasonable token budget
    const items: CandidateItem[] = [
      item({
        itemId: 1,
        chunks: [{ chunkId: 10, ord: 0, text: hugeText, ftsRank: null, vectorDistance: 0.1 }],
      }),
    ]

    const result = assembleContext(items, { tokenBudget: 100 })

    expect(result.sources).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  it('stops including further (lower-ranked) items once the budget is exhausted, logging them as excluded', () => {
    // 4,800 * 5 chars = 24,000 chars -> exactly 6,000 estimated tokens: consumes the ENTIRE
    // default budget on its own, leaving no room for anything after it.
    const bigText = 'word '.repeat(4_800)
    const items: CandidateItem[] = [
      item({
        itemId: 1,
        chunks: [{ chunkId: 10, ord: 0, text: bigText, ftsRank: null, vectorDistance: 0.1 }],
      }),
      item({
        itemId: 2,
        chunks: [
          { chunkId: 20, ord: 0, text: 'a small second item', ftsRank: null, vectorDistance: 0.2 },
        ],
      }),
    ]

    const result = assembleContext(items, { tokenBudget: DEFAULT_CONTEXT_TOKEN_BUDGET })

    expect(result.sources.map((s) => s.itemId)).toEqual([1])
    expect(result.truncated).toBe(true)
    const excludedEntry = result.retrievedChunks.find((c) => c.chunkId === 20)
    expect(excludedEntry?.includedInContext).toBe(false)
  })

  it('includes everything, untruncated, when the corpus comfortably fits the budget', () => {
    const items: CandidateItem[] = [
      item({
        itemId: 1,
        chunks: [
          { chunkId: 10, ord: 0, text: 'short body one', ftsRank: null, vectorDistance: 0.1 },
        ],
      }),
      item({
        itemId: 2,
        chunks: [
          { chunkId: 20, ord: 0, text: 'short body two', ftsRank: null, vectorDistance: 0.2 },
        ],
      }),
    ]

    const result = assembleContext(items)

    expect(result.truncated).toBe(false)
    expect(result.sources).toHaveLength(2)
  })

  it('returns everything empty for an empty candidate list', () => {
    const result = assembleContext([])
    expect(result).toEqual({
      sources: [],
      contextBlocks: [],
      retrievedChunks: [],
      truncated: false,
    })
  })
})

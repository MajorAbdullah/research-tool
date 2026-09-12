import { describe, expect, it } from 'vitest'
import { truncateToTokenBudget } from '@/lib/ai/truncate'

describe('truncateToTokenBudget', () => {
  it('leaves short content untouched', () => {
    const result = truncateToTokenBudget('short content', 1000)
    expect(result).toEqual({ text: 'short content', truncated: false })
  })

  it('preserves the conclusion of a long transcript instead of just cutting off the head', () => {
    const intro = 'INTRO. '.repeat(2000) // way over budget on its own
    const conclusion = 'In conclusion, the answer is 42. FINAL-MARKER.'
    const transcript = `${intro}${conclusion}`

    const result = truncateToTokenBudget(transcript, 500) // ~2000 chars kept
    expect(result.truncated).toBe(true)
    expect(result.text).toContain('FINAL-MARKER')
    expect(result.text.startsWith('INTRO.')).toBe(true)
    expect(result.text.length).toBeLessThan(transcript.length)
  })

  it('keeps more of the head than the tail by default (headRatio=0.7)', () => {
    const text = 'H'.repeat(10_000) + 'T'.repeat(10_000)
    const result = truncateToTokenBudget(text, 1000) // 4000 char budget
    const headSegment = result.text.split('\n\n[')[0] ?? ''
    expect(headSegment.length).toBeGreaterThan(2000) // roughly 70% of ~4000
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { EmbeddingProvider } from '@/types/contracts'
import {
  assignTopic,
  DEFAULT_TOPIC_DISTANCE_THRESHOLD,
  type ExistingTopic,
} from '@/lib/ai/topic-assignment'

function fakeEmbeddingProvider(vectorsByText: Record<string, number[]>): EmbeddingProvider {
  return {
    model: 'fake-embedder',
    dimensions: 2,
    embed: vi.fn(async (texts: string[]) => texts.map((t) => vectorsByText[t] ?? [0, 0])),
    embedQuery: vi.fn(async (text: string) => vectorsByText[text] ?? [0, 0]),
  }
}

describe('assignTopic', () => {
  it('proposes a new topic with no embedding call when none exist yet', async () => {
    const provider = fakeEmbeddingProvider({})
    const result = await assignTopic('First Topic Ever', [], provider)
    expect(result).toEqual({ isNew: true, label: 'First Topic Ever' })
    expect(provider.embed).not.toHaveBeenCalled()
  })

  it('does not invent "LLM Agents" when "Agent Frameworks" already exists and is a close match', async () => {
    const existing: ExistingTopic[] = [
      { id: 1, label: 'Agent Frameworks' },
      { id: 2, label: 'Cooking' },
    ]
    const provider = fakeEmbeddingProvider({
      'LLM Agents': [0.99, Math.sqrt(1 - 0.99 ** 2)], // ~0.99 cosine similarity to [1,0]
      'Agent Frameworks': [1, 0],
      Cooking: [0, 1], // orthogonal — unrelated
    })

    const result = await assignTopic('LLM Agents', existing, provider)

    expect(result.isNew).toBe(false)
    if (!result.isNew) {
      expect(result.topicId).toBe(1)
      expect(result.label).toBe('Agent Frameworks')
      expect(result.distance).toBeLessThan(DEFAULT_TOPIC_DISTANCE_THRESHOLD)
    }
  })

  it('proposes a genuinely new topic when nothing existing is close enough', async () => {
    const existing: ExistingTopic[] = [{ id: 1, label: 'Cooking' }]
    const provider = fakeEmbeddingProvider({
      'Distributed Systems': [1, 0],
      Cooking: [0, 1], // orthogonal — distance 1, far above the threshold
    })

    const result = await assignTopic('Distributed Systems', existing, provider)
    expect(result).toMatchObject({ isNew: true, label: 'Distributed Systems' })
  })

  it('batches the candidate and every existing topic into exactly one embed() call', async () => {
    const existing: ExistingTopic[] = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      label: `topic-${i}`,
    }))
    const provider = fakeEmbeddingProvider({})
    await assignTopic('a new candidate label', existing, provider)

    expect(provider.embed).toHaveBeenCalledTimes(1)
    const [texts] = (provider.embed as ReturnType<typeof vi.fn>).mock.calls[0] as [string[]]
    expect(texts).toHaveLength(6) // candidate + 5 existing
  })

  it('respects a custom distance threshold', async () => {
    const existing: ExistingTopic[] = [{ id: 1, label: 'Somewhat Related' }]
    // cosine distance here is 1 - cos(30 deg) ≈ 0.134
    const provider = fakeEmbeddingProvider({
      Candidate: [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)],
      'Somewhat Related': [1, 0],
    })

    const strict = await assignTopic('Candidate', existing, provider, 0.05)
    expect(strict.isNew).toBe(true)

    const lenient = await assignTopic('Candidate', existing, provider, 0.2)
    expect(lenient.isNew).toBe(false)
  })
})

/**
 * Topic assignment against existing topics (P3.2.3): the model proposes a free-text `topic` label
 * every time (it has no visibility into the topic list's ids, and re-listing the whole topic
 * table in every enrichment prompt would be both a prompt-size and a staleness problem). This
 * module decides whether that label actually means "reuse topic X" or "this is genuinely new,"
 * so the pipeline doesn't invent "LLM Agents" right next to an existing "Agent Frameworks."
 *
 * Uses the local `EmbeddingProvider` (P3.3.1), not another LLM call — comparing short topic labels
 * for similarity is exactly what embeddings are for, and doing it locally costs nothing against
 * the free-tier budget (ADR 0003) where a second structured LLM call would have.
 */

import type { EmbeddingProvider } from '@/types/contracts'

export interface ExistingTopic {
  id: number
  label: string
}

export type TopicAssignment =
  | { isNew: false; topicId: number; label: string; distance: number }
  | { isNew: true; label: string; distance?: number }

/**
 * Cosine distance in [0, ~2]; below this, the candidate label is considered "the same topic" as
 * the nearest existing one. Starting point, not a law of physics — P9.1.7's golden-set eval is
 * where this gets tuned against real recall/precision, per the plan's "what would reverse this"
 * pattern.
 */
export const DEFAULT_TOPIC_DISTANCE_THRESHOLD = 0.15

function cosineDistance(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }
  if (normA === 0 || normB === 0) return 1
  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB))
  return 1 - similarity
}

/**
 * `existingTopics` is embedded fresh every call, batched together with the candidate in one
 * `embed()` call (batching embeddings is a non-negotiable — CLAUDE.md) rather than being cached
 * on the topic rows, since `chunks`/`topics` persistence is outside P3's scope; the caller (P7)
 * re-fetches whatever topics currently exist each time.
 */
export async function assignTopic(
  candidateLabel: string,
  existingTopics: readonly ExistingTopic[],
  embeddingProvider: EmbeddingProvider,
  threshold: number = DEFAULT_TOPIC_DISTANCE_THRESHOLD,
): Promise<TopicAssignment> {
  if (existingTopics.length === 0) {
    return { isNew: true, label: candidateLabel }
  }

  // Comparing topic-label-to-topic-label is a symmetric similarity task, not a search — both
  // sides go through the document/passage path (`embed`), never `embedQuery`, which would apply
  // a retrieval instruction prefix that only makes sense for one side of a query/passage pair.
  const vectors = await embeddingProvider.embed([
    candidateLabel,
    ...existingTopics.map((t) => t.label),
  ])
  const candidateVec = vectors[0]
  if (!candidateVec) {
    return { isNew: true, label: candidateLabel }
  }

  let best: { topic: ExistingTopic; distance: number } | undefined
  for (let i = 0; i < existingTopics.length; i++) {
    const vec = vectors[i + 1]
    const topic = existingTopics[i]
    if (!vec || !topic) continue
    const distance = cosineDistance(candidateVec, vec)
    if (!best || distance < best.distance) {
      best = { topic, distance }
    }
  }

  if (best && best.distance <= threshold) {
    return { isNew: false, topicId: best.topic.id, label: best.topic.label, distance: best.distance }
  }
  return { isNew: true, label: candidateLabel, distance: best?.distance }
}

/**
 * Chunker (P3.3.5): ~500 tokens per chunk, 15% overlap, sentence-boundary aware. Prepends
 * chunk-level context (item title + what kind of item it is) *before* embedding — "contextual
 * retrieval," which is free here specifically because embeddings run locally (ADR 0003; a hosted
 * embedding API would turn this prefix into extra billed/quota-consuming tokens on every chunk).
 * Skips the sentence-splitting machinery entirely for short, self-contained items (a tweet, a
 * one-line repo description) — for those, splitting hurts retrieval rather than helping it, so
 * they become exactly one (still contextualized) chunk.
 */

import type { ItemKind, UtcMillis } from '@/types/contracts'
import { ItemKind as ItemKindValues } from '@/types/contracts'
import { estimateTokens } from '@/lib/ai/token-estimate'

export const TARGET_CHUNK_TOKENS = 500
export const CHUNK_OVERLAP_RATIO = 0.15
/** Below this, content counts as "short and self-contained" and is embedded as a single chunk
 *  without running through sentence splitting/windowing at all. ~200 tokens is comfortably above a
 *  tweet or a one-line repo description while staying well under one full target chunk. */
export const SHORT_ITEM_TOKEN_THRESHOLD = 200

/** Denormalized onto every chunk, not just derivable via an `items` join — P3.3.7: needed for
 *  citation, filtering, and retrieval-layer access control (filter by `userId` *before* the kNN,
 *  never after). */
export interface ChunkSourceMetadata {
  userId: number
  title: string
  url: string
  publishedAt?: UtcMillis
}

export interface ChunkInput extends ChunkSourceMetadata {
  kind: ItemKind
  contentText: string
}

export interface ChunkResult extends ChunkSourceMetadata {
  ord: number
  /** The exact text to hand to `EmbeddingProvider.embed()` — the contextual prefix is already
   *  baked in here, not applied separately at embed time. */
  text: string
}

function describeKind(kind: ItemKind): string {
  switch (kind) {
    case ItemKindValues.Github:
      return 'a GitHub repository'
    case ItemKindValues.Video:
      return 'a video'
    case ItemKindValues.Article:
      return 'an article'
    case ItemKindValues.Social:
      return 'a social media post'
    case ItemKindValues.Pdf:
      return 'a PDF document'
    case ItemKindValues.Audio:
      return 'an audio recording'
    case ItemKindValues.Other:
      return 'a saved item'
    default:
      return 'a saved item'
  }
}

function contextualize(title: string, kind: ItemKind, body: string): string {
  return `From "${title}" (${describeKind(kind)}):\n\n${body}`
}

// A "good enough for chunk boundaries" sentence splitter, not a real NLP sentence tokenizer:
// breaks after ./!/? when followed by whitespace and what looks like the start of a new sentence,
// or on a blank line (paragraph break). Good enough to avoid slicing mid-sentence for prose,
// transcripts, and READMEs; not meant to be perfect on abbreviations like "e.g.".
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=[A-Z0-9"'])|\n{2,}/

function splitIntoSentences(text: string): string[] {
  const normalized = text.trim()
  if (normalized === '') return []
  return normalized
    .split(SENTENCE_BOUNDARY)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function chunkContent(input: ChunkInput): ChunkResult[] {
  const content = input.contentText.trim()
  const meta: ChunkSourceMetadata = {
    userId: input.userId,
    title: input.title,
    url: input.url,
    publishedAt: input.publishedAt,
  }
  if (content === '') return []

  if (estimateTokens(content) <= SHORT_ITEM_TOKEN_THRESHOLD) {
    return [{ ...meta, ord: 0, text: contextualize(input.title, input.kind, content) }]
  }

  const sentences = splitIntoSentences(content)
  if (sentences.length === 0) return []

  const overlapTokenBudget = Math.floor(TARGET_CHUNK_TOKENS * CHUNK_OVERLAP_RATIO)
  const windows: string[] = []
  let current: string[] = []
  let currentTokens = 0

  const flush = (): void => {
    if (current.length > 0) windows.push(current.join(' '))
  }

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence)
    if (current.length > 0 && currentTokens + sentenceTokens > TARGET_CHUNK_TOKENS) {
      flush()
      // Seed the next window with a ~15%-of-target overlap tail from the window just flushed, so
      // a fact split across a chunk boundary still appears in full in at least one chunk.
      const overlap: string[] = []
      let overlapTokens = 0
      for (let i = current.length - 1; i >= 0 && overlapTokens < overlapTokenBudget; i--) {
        const s = current[i]
        if (!s) continue
        overlap.unshift(s)
        overlapTokens += estimateTokens(s)
      }
      current = overlap
      currentTokens = overlapTokens
    }
    current.push(sentence)
    currentTokens += sentenceTokens
  }
  flush()

  return windows.map((body, ord) => ({ ...meta, ord, text: contextualize(input.title, input.kind, body) }))
}

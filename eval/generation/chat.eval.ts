/**
 * The generation eval (`pnpm eval:rag`). Runs the FULL chat/RAG pipeline — retrieval, the
 * pre-generation groundedness gate, context assembly, and real generation via `createChatProvider()`
 * — against `eval/golden-set.ts`'s `GENERATION_CASES`, and reports **faithfulness and answer
 * relevancy as two separate numbers** (CLAUDE.md → RAG, eval/README.md), never blended.
 *
 * This is the one eval in this project that spends real free-tier requests (one `complete()` call
 * per grounded case, plus at most one corrective retry) — see `eval/README.md`'s header. It is not
 * part of `pnpm test`/CI, and is run deliberately, the same way `pnpm smoke:ai` is.
 *
 * ## How each number is computed (and why, given this project has no RAGAS dependency)
 *
 * `package.json` doesn't depend on the `ragas` package — every eval in this repo (see
 * `eval/retrieval/hybrid.eval.ts`'s own hand-written context-precision/recall) implements its own
 * metric functions rather than shelling out to it. This file follows the same convention:
 *
 * - **Answer relevancy** — cosine similarity between the LOCAL embedding of the question and the
 *   LOCAL embedding of the generated answer (the standard RAGAS answer-relevancy proxy: does the
 *   answer, as a piece of text, actually address what was asked — independent of whether it's
 *   factually correct). Costs zero OpenRouter quota; only the generation call itself does.
 * - **Faithfulness** — is the answer's content actually grounded in what was retrieved? Scored as
 *   the average of four checks: (1) at least one citation marker is present, (2) every citation
 *   marker refers to a source the model was actually given (no invented `[9]`), (3) each cited
 *   sentence shares real vocabulary with the specific source it cites (a lightweight, deterministic
 *   stand-in for "is this sentence actually supported by this source" — full semantic entailment
 *   would need a second LLM-judge call, spending quota this project's budget model exists to
 *   conserve), and (4) the case's `mustMention` substrings actually appear. For the
 *   `expectInsufficient` case, faithfulness instead asks the one question that matters: did the
 *   pipeline correctly say it has nothing, instead of fabricating an answer?
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { makeTestDb, type TestDb } from '../../tests/helpers/db'
import { makeUser } from '../../tests/helpers/factories'
import { getLocalEmbeddingProvider } from '@/lib/embeddings'
import { tokenizeForFts } from '@/lib/search'
import { getConfig } from '@/lib/config'
import {
  fetchModelCapabilities,
  CapabilityProbe,
  BudgetManager,
  TokenBucket,
  createInMemoryLlmCallLog,
  createInMemorySettingsPort,
  createChatProvider,
  RATE_LIMIT_PER_MINUTE,
} from '@/lib/ai'
import {
  retrieveCandidates,
  assembleContext,
  buildChatMessages,
  generateGroundedAnswer,
  validateCitations,
  extractCitationIndices,
  looksLikeRefusal,
  INSUFFICIENT_CONTEXT_MESSAGE,
} from '@/lib/rag'
import { CORPUS, GENERATION_CASES, type GenerationCase } from '../golden-set'

const USER_ID = 1

let db: TestDb
let provider: ReturnType<typeof createChatProvider>

beforeAll(async () => {
  db = makeTestDb()
  makeUser(db, USER_ID)

  const embeddingProvider = getLocalEmbeddingProvider()
  const vectors = await embeddingProvider.embed(CORPUS.map((doc) => doc.text))

  CORPUS.forEach((doc, index) => {
    const itemId = index + 1
    db.prepare(
      `INSERT INTO items
         (id, user_id, url, canonical_url, url_hash, kind, status, extraction_tier,
          source_surface, title, content_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'inbox', 'full', 'extension', ?, ?, ?, ?)`,
    ).run(
      itemId,
      USER_ID,
      `https://eval.test/${doc.id}`,
      `https://eval.test/${doc.id}`,
      `hash-${doc.id}`,
      doc.kind,
      doc.title,
      doc.text,
      Date.now(),
      Date.now(),
    )
    const chunkInfo = db
      .prepare(
        `INSERT INTO chunks (item_id, user_id, ord, text, embedding_model) VALUES (?, ?, 0, ?, ?)`,
      )
      .run(itemId, USER_ID, doc.text, embeddingProvider.model)
    const vector = vectors[index]
    if (!vector) throw new Error(`no embedding for '${doc.id}'`)
    db.prepare('INSERT INTO chunk_vec (rowid, embedding) VALUES (?, ?)').run(
      BigInt(chunkInfo.lastInsertRowid),
      new Float32Array(vector),
    )
  })

  const config = getConfig()
  const capabilityProbe = new CapabilityProbe(
    await fetchModelCapabilities({ apiKey: config.openRouterApiKey }),
  )
  const budget = new BudgetManager(
    createInMemorySettingsPort(),
    config.llmDailyCap,
    config.llmInteractiveReserve,
  )
  const rateLimiter = new TokenBucket({
    capacity: RATE_LIMIT_PER_MINUTE,
    refillPerMinute: RATE_LIMIT_PER_MINUTE,
  })
  provider = createChatProvider({
    apiKey: config.openRouterApiKey,
    chainEnrich: config.llmChainEnrich,
    chainChat: config.llmChainChat,
    capabilityProbe,
    budget,
    rateLimiter,
    callLog: createInMemoryLlmCallLog(),
    promptVersion: 'chat.v1',
  })
}, 60_000)

afterAll(() => {
  db.close()
})

// ---------------------------------------------------------------------------
// Metric helpers — see file header for what each measures and why.
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

async function answerRelevancy(query: string, answer: string): Promise<number> {
  const embeddingProvider = getLocalEmbeddingProvider()
  const [queryVector, [answerVector]] = await Promise.all([
    embeddingProvider.embedQuery(query),
    embeddingProvider.embed([answer]),
  ])
  if (!answerVector) return 0
  return clamp01(cosineSimilarity(queryVector, answerVector))
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function tokenSet(text: string): Set<string> {
  return new Set(tokenizeForFts(text))
}

/** Fraction of `sentenceTokens` also present in `sourceTokens` — a deliberately simple, cheap
 *  stand-in for "is this sentence actually supported by this source." */
function overlapRatio(
  sentenceTokens: ReadonlySet<string>,
  sourceTokens: ReadonlySet<string>,
): number {
  if (sentenceTokens.size === 0) return 0
  let hits = 0
  for (const token of sentenceTokens) if (sourceTokens.has(token)) hits++
  return hits / sentenceTokens.size
}

function mustMentionCoverage(answer: string, mustMention: readonly string[]): number {
  if (mustMention.length === 0) return 1
  const lower = answer.toLowerCase()
  const hits = mustMention.filter((m) => lower.includes(m.toLowerCase())).length
  return hits / mustMention.length
}

/** Average per-cited-sentence overlap between the sentence and whichever of its cited sources it
 *  overlaps best with. Sentences with no citation at all don't participate (citation presence is
 *  scored separately) — this only asks, of the sentences that DID cite something, whether the
 *  citation looks textually supported. */
function citationGroundedOverlap(
  answer: string,
  sourceTextByIndex: ReadonlyMap<number, string>,
): number {
  const sentences = splitSentences(answer)
  const scores: number[] = []
  for (const sentence of sentences) {
    const indices = extractCitationIndices(sentence)
    if (indices.length === 0) continue
    const sentenceTokens = tokenSet(sentence)
    let best = 0
    for (const index of indices) {
      const sourceText = sourceTextByIndex.get(index)
      if (!sourceText) continue
      best = Math.max(best, overlapRatio(sentenceTokens, tokenSet(sourceText)))
    }
    scores.push(best > 0.1 ? 1 : 0)
  }
  return scores.length === 0 ? 0 : scores.reduce((a, b) => a + b, 0) / scores.length
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

interface CaseResult {
  query: string
  grounded: boolean
  answer: string
  faithfulness: number
  answerRelevancy: number
}

async function runCase(testCase: GenerationCase): Promise<CaseResult> {
  const embeddingProvider = getLocalEmbeddingProvider()
  const raw = await retrieveCandidates(
    { sqlite: db, embeddingProvider },
    { userId: USER_ID, query: testCase.query },
  )
  const assembled = assembleContext(raw.items)
  const grounded = raw.groundedPreGate && assembled.sources.length > 0

  let answerText: string
  if (!grounded) {
    // Mirrors the real route: retrieval too weak to even attempt generation — zero LLM cost.
    answerText = INSUFFICIENT_CONTEXT_MESSAGE
  } else {
    const { messages } = buildChatMessages({
      question: testCase.query,
      contextBlocks: assembled.contextBlocks,
    })
    const result = await generateGroundedAnswer(provider, messages, assembled.sources.length)
    answerText = result.text
  }

  const relevancy = await answerRelevancy(testCase.query, answerText)

  let faithfulness: number
  if (testCase.expectInsufficient) {
    // The only question that matters here: did it correctly decline instead of inventing an
    // answer? A fabricated citation on top of that would be doubly wrong.
    const declined = !grounded || looksLikeRefusal(answerText)
    const validation = validateCitations(answerText, assembled.sources.length)
    const fabricatedCitation = validation.hasAnyMarker && !validation.valid
    faithfulness = declined && !fabricatedCitation ? 1 : 0
  } else {
    const validation = validateCitations(answerText, assembled.sources.length)
    const sourceTextByIndex = new Map(
      assembled.sources.map((s, i) => [s.index, joinItemChunks(raw.items[i])]),
    )
    faithfulness = average([
      validation.hasAnyMarker ? 1 : 0,
      validation.valid ? 1 : 0,
      citationGroundedOverlap(answerText, sourceTextByIndex),
      mustMentionCoverage(answerText, testCase.mustMention),
    ])
  }

  return {
    query: testCase.query,
    grounded,
    answer: answerText,
    faithfulness,
    answerRelevancy: relevancy,
  }
}

function joinItemChunks(item: { chunks: { text: string }[] } | undefined): string {
  return item ? item.chunks.map((c) => c.text).join(' ') : ''
}

describe('chat generation eval (golden set)', () => {
  it('scores faithfulness and answer relevancy separately across GENERATION_CASES', async () => {
    const results: CaseResult[] = []
    for (const testCase of GENERATION_CASES) {
      // Sequential, not parallel — same pacing discipline as production (TokenBucket) and it
      // keeps console output readable per case.
      console.log(`\n[running] "${testCase.query}"`)
      const result = await runCase(testCase)
      console.log(`[done] grounded=${result.grounded} -> ${result.answer.slice(0, 160)}`)
      results.push(result)
    }

    console.log('\n=== Generation eval: faithfulness & answer relevancy (reported separately) ===')
    for (const r of results) {
      console.log(
        `\n"${r.query}"\n  grounded=${r.grounded}  faithfulness=${r.faithfulness.toFixed(2)}  ` +
          `answerRelevancy=${r.answerRelevancy.toFixed(2)}\n  -> ${r.answer.slice(0, 220)}`,
      )
    }

    const meanFaithfulness = average(results.map((r) => r.faithfulness))
    const meanRelevancy = average(results.map((r) => r.answerRelevancy))
    console.log(
      `\n=== TOTALS ===  faithfulness = ${meanFaithfulness.toFixed(3)}   ` +
        `answer relevancy = ${meanRelevancy.toFixed(3)}\n`,
    )

    // ---- Flagship assertion — the primary hallucination guard, per golden-set.ts's rationale ----
    const insufficientCase = results.find(
      (r) => GENERATION_CASES.find((c) => c.query === r.query)?.expectInsufficient,
    )
    expect(
      insufficientCase,
      'the expectInsufficient case must exist in the golden set',
    ).toBeDefined()
    expect(
      insufficientCase!.grounded === false || looksLikeRefusal(insufficientCase!.answer),
      'the Kubernetes-operators case must NOT be answered as if the library had something — ' +
        'grounded must be false, or the model must have explicitly declined',
    ).toBe(true)
    expect(
      insufficientCase!.faithfulness,
      'a correct decline must score faithfulness 1 (no fabrication), never partial credit',
    ).toBe(1)

    // Sanity floor over the answerable cases, not a tuning target (mirrors the retrieval eval's
    // own "sanity floor, not a fuzz test" framing).
    const answerableCases = results.filter(
      (r) => !GENERATION_CASES.find((c) => c.query === r.query)?.expectInsufficient,
    )
    expect(average(answerableCases.map((r) => r.faithfulness))).toBeGreaterThan(0.5)
  }, 600_000) // 3 cases x up to 2 real completions each, sequential, against free-tier models —
  // generous headroom above vitest.eval.config.mts's 120s global default (this per-test value
  // takes precedence over it).
})

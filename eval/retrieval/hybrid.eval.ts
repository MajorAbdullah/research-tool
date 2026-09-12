/**
 * The retrieval eval (`pnpm eval`). Scores FTS-only, vector-only, and RRF-fused rankings against
 * `eval/golden-set.ts`'s `RETRIEVAL_CASES`, reporting **context precision and context recall as
 * two separate numbers** (CLAUDE.md → RAG, eval/README.md) — never blended — plus recall@10 per
 * case, for all three rankings so a regression can be attributed to the keyword half, the
 * semantic half, or the fusion step itself.
 *
 * Runs on the real local embedding model (`@/lib/embeddings`, `bge-small-en-v1.5`) — no
 * OpenRouter calls, no mocks standing in for retrieval quality. That's the whole point: this eval
 * costs zero free-tier quota, so there is no reason not to run it constantly.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { makeTestDb, type TestDb } from '../../tests/helpers/db'
import { makeUser } from '../../tests/helpers/factories'
import { getLocalEmbeddingProvider } from '@/lib/embeddings'
import { ftsSearch } from '@/lib/search/fts-search'
import { vectorSearch } from '@/lib/search/vector-search'
import { reciprocalRankFusion, DEFAULT_RRF_K } from '@/lib/search/rrf'
import { CORPUS, RETRIEVAL_CASES } from '../golden-set'

const USER_ID = 1
/** Larger than the whole corpus (7 docs) — this is "rank everything," not a real page size, so
 *  precision/recall are measured over the full ranking rather than an arbitrarily truncated one. */
const RETRIEVE_LIMIT = 10

let db: TestDb
const docIdByItemId = new Map<number, string>()

beforeAll(async () => {
  db = makeTestDb()
  makeUser(db, USER_ID)

  const provider = getLocalEmbeddingProvider()
  // One batched embed() call for the whole corpus — documents go through the passage path, never
  // embedQuery() (that asymmetry is the entire point of P3's two-method EmbeddingProvider).
  const vectors = await provider.embed(CORPUS.map((doc) => doc.text))

  CORPUS.forEach((doc, index) => {
    const itemId = index + 1
    docIdByItemId.set(itemId, doc.id)

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

    // Each corpus doc is short and self-contained -> one chunk, no splitting (rag-best-practices
    // §1: "skip chunking entirely for short, self-contained documents").
    const chunkInfo = db
      .prepare(
        `INSERT INTO chunks (item_id, user_id, ord, text, embedding_model) VALUES (?, ?, 0, ?, ?)`,
      )
      .run(itemId, USER_ID, doc.text, provider.model)

    const vector = vectors[index]
    if (!vector) throw new Error(`local embedding provider returned no vector for '${doc.id}'`)
    db.prepare('INSERT INTO chunk_vec (rowid, embedding) VALUES (?, ?)').run(
      BigInt(chunkInfo.lastInsertRowid),
      new Float32Array(vector),
    )
  })
})

afterAll(() => {
  db.close()
})

function docIdsOf(itemIds: readonly number[]): string[] {
  return itemIds.map((id) => docIdByItemId.get(id) ?? `unknown-item-${id}`)
}

/**
 * Order-aware context precision (RAGAS's definition): the average of precision@k taken at every
 * rank `k` whose item is actually relevant. Rewards relevant items ranking early, not just being
 * present somewhere in the list. 0 when nothing relevant was retrieved at all.
 */
function contextPrecision(retrievedDocIds: readonly string[], relevant: ReadonlySet<string>): number {
  let hits = 0
  let sumPrecisionAtK = 0
  retrievedDocIds.forEach((docId, index) => {
    if (relevant.has(docId)) {
      hits++
      sumPrecisionAtK += hits / (index + 1)
    }
  })
  return hits === 0 ? 0 : sumPrecisionAtK / hits
}

/** Fraction of a case's ground-truth relevant docs found within the top `k` retrieved. */
function recallAtK(
  retrievedDocIds: readonly string[],
  relevant: ReadonlySet<string>,
  k: number,
): number {
  if (relevant.size === 0) return 1
  const topK = new Set(retrievedDocIds.slice(0, k))
  let found = 0
  for (const id of relevant) if (topK.has(id)) found++
  return found / relevant.size
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

interface MethodReport {
  name: string
  /** Context precision, averaged across every case — a distinct number from recall, never
   *  blended into it (CLAUDE.md → RAG, eval/README.md). */
  precision: number
  /** Context recall@10, averaged across every case. */
  recall: number
  recallAt10ByCase: { query: string; recallAt10: number }[]
}

function evaluateMethod(name: string, rankingsByCase: readonly (readonly number[])[]): MethodReport {
  const precisions: number[] = []
  const recallAt10ByCase: { query: string; recallAt10: number }[] = []

  RETRIEVAL_CASES.forEach((testCase, index) => {
    const ranking = rankingsByCase[index] ?? []
    const retrievedDocIds = docIdsOf(ranking)
    const relevant = new Set(testCase.relevant)

    precisions.push(contextPrecision(retrievedDocIds, relevant))
    recallAt10ByCase.push({ query: testCase.query, recallAt10: recallAtK(retrievedDocIds, relevant, 10) })
  })

  return {
    name,
    precision: average(precisions),
    recall: average(recallAt10ByCase.map((r) => r.recallAt10)),
    recallAt10ByCase,
  }
}

function printReport(report: MethodReport): void {
  console.log(
    `\n[${report.name}]  context precision = ${report.precision.toFixed(3)}   ` +
      `context recall@10 = ${report.recall.toFixed(3)}`,
  )
  for (const row of report.recallAt10ByCase) {
    console.log(`  recall@10 = ${row.recallAt10.toFixed(2)}  — "${row.query}"`)
  }
}

describe('hybrid search retrieval eval (golden set)', () => {
  it(
    'reports context precision + context recall separately for FTS-only, vector-only, and RRF-fused',
    async () => {
      const provider = getLocalEmbeddingProvider()

      const ftsRankings: number[][] = []
      const vectorRankings: number[][] = []
      const fusedRankings: number[][] = []

      for (const testCase of RETRIEVAL_CASES) {
        const ftsHits = ftsSearch(db, { userId: USER_ID, query: testCase.query, limit: RETRIEVE_LIMIT })
        // embedQuery(), never embed() — the query side of BGE's asymmetric instruction prefix.
        const queryEmbedding = await provider.embedQuery(testCase.query)
        const vectorHits = vectorSearch(db, {
          userId: USER_ID,
          queryEmbedding,
          limit: RETRIEVE_LIMIT,
        })
        const fused = reciprocalRankFusion(
          { fts: ftsHits.map((h) => h.itemId), vector: vectorHits.map((h) => h.itemId) },
          DEFAULT_RRF_K,
        )

        ftsRankings.push(ftsHits.map((h) => h.itemId))
        vectorRankings.push(vectorHits.map((h) => h.itemId))
        fusedRankings.push(fused.map((f) => f.id))
      }

      const ftsReport = evaluateMethod('fts-only', ftsRankings)
      const vectorReport = evaluateMethod('vector-only', vectorRankings)
      const fusedReport = evaluateMethod('rrf-fused', fusedRankings)

      console.log('\n=== Retrieval eval: context precision & context recall (reported separately) ===')
      printReport(ftsReport)
      printReport(vectorReport)
      printReport(fusedReport)

      const fusedCombined = fusedReport.precision + fusedReport.recall
      const bestSingleCombined = Math.max(
        ftsReport.precision + ftsReport.recall,
        vectorReport.precision + vectorReport.recall,
      )
      if (fusedCombined + 1e-9 < bestSingleCombined) {
        console.log(
          '\n*** FINDING: RRF fusion did NOT beat the better of the two single rankings on this ' +
            'golden set — see the final report for what this means. ***',
        )
      } else {
        console.log('\nRRF fusion matched or beat both single rankings on this golden set.')
      }

      // ---- Flagship assertions — see golden-set.ts's rationale for each ----
      const diffusionCase = RETRIEVAL_CASES.findIndex((c) => c.query === 'video diffusion fine-tuning')
      expect(diffusionCase, 'the flagship "video diffusion fine-tuning" case must exist in the golden set').toBeGreaterThanOrEqual(0)
      const diffusionRanking = docIdsOf(fusedRankings[diffusionCase] ?? [])
      expect(
        diffusionRanking,
        'flagship case: "video diffusion fine-tuning" must retrieve reel-diffusion (a pure-clickbait ' +
          'title with no lexical overlap) — if this fails, semantic retrieval is broken',
      ).toContain('reel-diffusion')

      const pagedAttnCase = RETRIEVAL_CASES.findIndex((c) => c.query === 'PagedAttention')
      expect(pagedAttnCase, 'the flagship "PagedAttention" case must exist in the golden set').toBeGreaterThanOrEqual(0)
      const pagedAttnRanking = docIdsOf(fusedRankings[pagedAttnCase] ?? [])
      expect(
        pagedAttnRanking,
        'flagship case: "PagedAttention" must retrieve vllm — if this fails, the keyword half of ' +
          'the hybrid is broken',
      ).toContain('vllm')

      // A sanity floor, not a tuning target — this is a golden set, not a fuzz test. If this
      // drifts near 0, something is structurally broken, not merely "needs tuning".
      expect(fusedReport.recall).toBeGreaterThan(0.5)
    },
  )
})

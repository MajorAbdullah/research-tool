/**
 * Wraps an `EmbeddingProvider` so every request it makes is reserved against the shared free-tier
 * budget first (ADR 0004, CLAUDE.md "The Free-Tier Budget").
 *
 * Only meaningful for a HOSTED provider. The local model spends no requests at all, which is why
 * ADR 0003 originally described search as costing zero quota — with an OpenRouter embedding model
 * that stops being true, and every search query, every `embed()` batch during ingest, and every
 * re-embed batch competes for the same 1,000/day pool as enrichment and chat. Measured against
 * the live endpoint: embedding calls do increment `free_model_daily_requests`, so they must be
 * counted here rather than assumed free.
 *
 * Lanes matter. Ingest embedding is `background`, so a big import stops at
 * `dailyCap - interactiveReserve` and cannot starve your own searches; a search query is
 * `interactive` and may use the full cap. That is the same split enrichment and chat already use.
 *
 * On exhaustion this throws `BudgetExhaustedError` rather than returning a sentinel, because the
 * callers already understand it: the pipeline re-queues the job until the UTC reset, and the
 * search route catches it and degrades to keyword-only. Search must keep working at zero budget —
 * that property is non-negotiable.
 */

import type { EmbeddingProvider } from '@/types/contracts'
import type { BudgetLane, BudgetManager } from '@/lib/ai/budget'
import { BudgetExhaustedError } from '@/lib/ai/errors'

export class BudgetedEmbeddingProvider implements EmbeddingProvider {
  readonly model: string
  readonly dimensions: number

  constructor(
    private readonly inner: EmbeddingProvider,
    private readonly budget: BudgetManager,
    /** `background` for ingest/re-embed, `interactive` for a query the user is waiting on. */
    private readonly lane: BudgetLane,
  ) {
    this.model = inner.model
    this.dimensions = inner.dimensions
  }

  private reserve(): void {
    const result = this.budget.reserve(this.lane)
    if (!result.ok) {
      throw new BudgetExhaustedError(result.resetAt, result.lane)
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    // An empty batch makes no request, so it must not consume budget — reserving here would
    // silently burn quota on a no-op during a pipeline run with nothing to embed.
    if (texts.length === 0) return []
    // ONE reservation per call, not per text: the underlying provider batches the whole array
    // into a single HTTP request, so charging per text would over-count by the batch size and
    // exhaust the day ~64x early.
    this.reserve()
    return this.inner.embed(texts)
  }

  async embedQuery(text: string): Promise<number[]> {
    this.reserve()
    return this.inner.embedQuery(text)
  }
}

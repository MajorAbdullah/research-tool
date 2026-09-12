/**
 * The shared "try rungs in order, stop at the first success" runner used by the four extractors
 * that actually degrade gracefully: article, youtube, instagram, x-threads (ADR 0006).
 *
 * GitHub and PDF/arXiv deliberately do NOT use this. Both are single-rung API calls that are
 * either `full` or a genuine, caller-visible failure — "always full or a hard failure" per the P2
 * spec — so they throw an `ExtractionError` directly instead of degrading. Using `runLadder` for
 * them would force a fake lower rung into existence for no behavioral benefit.
 */
import type { ExtractedContent, ExtractionTier } from '@/types/contracts'

export interface Rung {
  /** The extraction_tier this rung represents if it succeeds. */
  tier: ExtractionTier
  /** Short, stable name for log lines — which rung of a ladder is flaky matters for debugging. */
  name: string
  run: () => Promise<Omit<ExtractedContent, 'extractionTier'> | null>
}

export interface LadderLogger {
  warn(message: string, meta?: Record<string, unknown>): void
}

export const consoleLadderLogger: LadderLogger = {
  warn(message, meta) {
     
    // wants structured logs injects its own LadderLogger (e.g. P7's pino instance) instead.
    console.warn(`[extractors] ${message}`, meta ?? {})
  },
}

/**
 * Runs each rung in order and returns the first one that produces a result. A rung that throws or
 * returns null is logged and treated as "try the next rung" — never fatal on its own.
 *
 * Every caller MUST end the list with a rung that cannot itself fail (no I/O — pure data derived
 * from the URL alone) so this function can guarantee it never throws for well-formed callers. See
 * ADR 0006 and CLAUDE.md, "Never let extraction failure look like success."
 */
export async function runLadder(
  rungs: readonly Rung[],
  logger: LadderLogger = consoleLadderLogger,
): Promise<ExtractedContent> {
  for (const rung of rungs) {
    try {
      const result = await rung.run()
      if (result) return { ...result, extractionTier: rung.tier }
      logger.warn(`extraction rung "${rung.name}" produced no result, trying the next rung`, {
        tier: rung.tier,
      })
    } catch (err) {
      logger.warn(`extraction rung "${rung.name}" failed, trying the next rung`, {
        tier: rung.tier,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  throw new Error(
    'runLadder: every rung failed, including the final one — the caller must supply a last rung ' +
      'that cannot itself fail (e.g. a pure URL-only fallback)',
  )
}

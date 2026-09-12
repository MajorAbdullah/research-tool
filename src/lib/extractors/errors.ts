/**
 * The one error type every extractor throws. Two very different situations use it:
 *
 * 1. A ladder-based extractor (article/youtube/instagram/x-threads) uses this internally between
 *    rungs, but `runLadder` catches it (and anything else) and never lets it reach the caller —
 *    see ladder.ts. Those extractors always *resolve*, never reject, per ADR 0006.
 * 2. A single-rung API extractor (github/pdf) has no lower rung to fall back to, so a genuine
 *    failure (404, invalid PDF, rate limit) is thrown all the way to the caller. That's
 *    deliberate — see github.ts / pdf.ts module comments.
 */
export type ExtractionErrorCode =
  'unsupported_url' | 'not_found' | 'rate_limited' | 'blocked' | 'invalid_pdf' | 'network_error'

export interface ExtractionErrorOptions {
  /** Defaults per-code (see DEFAULT_RETRYABLE) — override only when a caller knows better. */
  retryable?: boolean
  /** When known (e.g. from a rate-limit reset header), how long before retrying makes sense. */
  retryAfterMs?: number
  cause?: unknown
}

const DEFAULT_RETRYABLE: Record<ExtractionErrorCode, boolean> = {
  unsupported_url: false,
  not_found: false,
  rate_limited: true,
  blocked: true,
  invalid_pdf: false,
  network_error: true,
}

export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode
  readonly retryable: boolean
  readonly retryAfterMs?: number

  constructor(code: ExtractionErrorCode, message: string, options: ExtractionErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = 'ExtractionError'
    this.code = code
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE[code]
    this.retryAfterMs = options.retryAfterMs
  }
}

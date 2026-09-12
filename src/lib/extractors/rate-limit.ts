/**
 * Two composable reliability primitives, deliberately kept separate (SRP):
 *
 * - `DomainRateLimiter` spaces calls to the *same* domain apart so a burst of queued jobs (e.g.
 *   20 YouTube URLs enqueued together) hits the network as a trickle, not a thundering herd.
 * - `withRetry` retries a single call a bounded number of times with exponential backoff.
 *
 * `createHttpClient` (http.ts) composes both around every outbound request by default. Nothing
 * here does real I/O, so both are trivially unit-testable with fake timers — see
 * tests/unit/extractors/rate-limit.test.ts.
 */

export interface DomainRateLimiterOptions {
  /** Minimum spacing between requests to the same domain. Default: 250ms. */
  minIntervalMs?: number
  /** Per-domain overrides (lowercase hostname -> ms) for APIs with documented courtesy limits. */
  perDomainMinIntervalMs?: Record<string, number>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_MIN_INTERVAL_MS = 250

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * FIFO-per-domain scheduler. Every call to `schedule(domain, fn)` for the same domain runs no
 * sooner than `minIntervalMs` after the previous one *started* running, regardless of how many
 * callers show up in the same tick — the whole point is that queuing 20 calls at once doesn't
 * fire 20 requests at once.
 */
export class DomainRateLimiter {
  private readonly defaultIntervalMs: number
  private readonly perDomainIntervalMs: Record<string, number>
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly nextTurn = new Map<string, Promise<number>>()

  constructor(options: DomainRateLimiterOptions = {}) {
    this.defaultIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
    this.perDomainIntervalMs = options.perDomainMinIntervalMs ?? {}
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? defaultSleep
  }

  schedule<T>(domain: string, fn: () => Promise<T>): Promise<T> {
    const key = domain.toLowerCase()
    const intervalMs = this.perDomainIntervalMs[key] ?? this.defaultIntervalMs

    // `nextTurn.get(key)` captures the tail of this domain's chain *synchronously*, before any
    // awaiting happens, so concurrent callers in the same tick still form a strict FIFO chain
    // rather than racing to read the same "previous" turn.
    const previousTurn = this.nextTurn.get(key) ?? Promise.resolve(0)

    const myTurn = previousTurn.then(async (freeAtMs) => {
      const waitMs = Math.max(0, freeAtMs - this.now())
      if (waitMs > 0) await this.sleep(waitMs)
      return this.now() + intervalMs
    })

    this.nextTurn.set(key, myTurn)
    return myTurn.then(() => fn())
  }
}

export interface RetryOptions {
  /** Total attempts, including the first — default 3 (per the P2 spec). */
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** Default: retry everything. HTTP callers should pass `err => err.retryable`. */
  isRetryable?: (err: unknown) => boolean
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 300
const DEFAULT_MAX_DELAY_MS = 5000

/** Exponential backoff: baseDelayMs * 2^(attempt-1), capped at maxDelayMs. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const isRetryable = options.isRetryable ?? (() => true)
  const sleep = options.sleep ?? defaultSleep

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= maxAttempts || !isRetryable(err)) throw err
      const delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
      await sleep(delayMs)
    }
  }
}

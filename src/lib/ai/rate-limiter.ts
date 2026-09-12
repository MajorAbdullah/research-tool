/**
 * Token bucket paced under OpenRouter's global 20 req/min ceiling (ADR 0004/0005 P3.1.7). One
 * instance is shared across BOTH chains (enrichment and chat) — the 20/min limit is account-wide,
 * not per-chain, so pacing has to be too.
 *
 * Continuous refill (not "reset 18 tokens every 60s on the clock") so bursts don't cluster at
 * minute boundaries. `clock`/`sleep` are injectable so tests can use vitest's fake timers instead
 * of real 60-second waits.
 */

export interface TokenBucketOptions {
  capacity: number
  /** Tokens restored per minute. */
  refillPerMinute: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export class TokenBucket {
  private readonly capacity: number
  private readonly refillPerMs: number
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private tokens: number
  private lastRefillAt: number
  /** Serializes waiters so tokens are handed out in arrival order, not first-to-wake-up order. */
  private queueTail: Promise<void> = Promise.resolve()

  constructor(options: TokenBucketOptions) {
    if (options.capacity <= 0) throw new Error('TokenBucket capacity must be > 0')
    if (options.refillPerMinute <= 0) throw new Error('TokenBucket refillPerMinute must be > 0')
    this.capacity = options.capacity
    this.refillPerMs = options.refillPerMinute / 60_000
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? defaultSleep
    this.tokens = options.capacity
    this.lastRefillAt = this.now()
  }

  /** Current token count, for tests/observability. Triggers a refill first. */
  available(): number {
    this.refill()
    return this.tokens
  }

  private refill(): void {
    const t = this.now()
    const elapsed = Math.max(0, t - this.lastRefillAt)
    if (elapsed === 0) return
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs)
    this.lastRefillAt = t
  }

  /** Resolves once a slot is available, having spent it. May wait; never rejects. */
  async acquire(): Promise<void> {
    const myTurn = this.queueTail
    let release: () => void = () => {}
    this.queueTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await myTurn
    try {
      await this.waitForToken();
    } finally {
      release()
    }
  }

  private async waitForToken(): Promise<void> {
    for (;;) {
      this.refill()
      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }
      const deficit = 1 - this.tokens
      const waitMs = Math.max(1, Math.ceil(deficit / this.refillPerMs))
      await this.sleep(waitMs)
    }
  }
}

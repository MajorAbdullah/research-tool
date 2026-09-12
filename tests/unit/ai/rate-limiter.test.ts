import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { TokenBucket } from '@/lib/ai/rate-limiter'

describe('TokenBucket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lets calls through immediately while capacity remains', async () => {
    const bucket = new TokenBucket({ capacity: 3, refillPerMinute: 18 })
    await bucket.acquire()
    await bucket.acquire()
    await bucket.acquire()
    expect(bucket.available()).toBeCloseTo(0, 5)
  })

  it('blocks the caller once the bucket is empty, until it refills', async () => {
    const bucket = new TokenBucket({ capacity: 1, refillPerMinute: 60 }) // 1 token/sec
    await bucket.acquire() // spends the only token

    let resolved = false
    const pending = bucket.acquire().then(() => {
      resolved = true
    })

    await vi.advanceTimersByTimeAsync(500)
    expect(resolved).toBe(false) // half a second isn't enough for a full refill at 1/sec

    await vi.advanceTimersByTimeAsync(600)
    await pending
    expect(resolved).toBe(true)
  })

  it('paces a burst under the configured per-minute rate rather than letting it all through at once', async () => {
    // 18 req/min == under OpenRouter's 20 RPM ceiling (ADR 0004/P3.1.7).
    const bucket = new TokenBucket({ capacity: 18, refillPerMinute: 18 })
    const order: number[] = []

    const acquisitions = Array.from({ length: 20 }, (_, i) =>
      bucket.acquire().then(() => order.push(i)),
    )

    // The first 18 should drain the initial capacity without needing any time to pass.
    await vi.advanceTimersByTimeAsync(0)
    expect(order.length).toBe(18)

    // The 19th and 20th need the bucket to refill — 60s/18 ≈ 3333ms per token.
    await vi.advanceTimersByTimeAsync(3400)
    await vi.advanceTimersByTimeAsync(3400)
    await Promise.all(acquisitions)
    expect(order.length).toBe(20)
  })

  it('hands out tokens in arrival order, not wake-up order', async () => {
    const bucket = new TokenBucket({ capacity: 1, refillPerMinute: 60 })
    await bucket.acquire()

    const order: string[] = []
    const first = bucket.acquire().then(() => order.push('first'))
    const second = bucket.acquire().then(() => order.push('second'))

    await vi.advanceTimersByTimeAsync(2000)
    await Promise.all([first, second])
    expect(order).toEqual(['first', 'second'])
  })
})

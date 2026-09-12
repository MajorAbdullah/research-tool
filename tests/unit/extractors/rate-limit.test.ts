import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DomainRateLimiter, withRetry } from '@/lib/extractors/rate-limit'

describe('DomainRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('spaces 20 queued calls to the same domain instead of firing them all at once', async () => {
    const limiter = new DomainRateLimiter({ minIntervalMs: 200 })
    const calledAt: number[] = []

    // Queue all 20 "at once" — this is the shape of the acceptance criterion: 20 YouTube URLs
    // enqueued together, not trickled in one at a time by the caller.
    const tasks = Array.from({ length: 20 }, () =>
      limiter.schedule('youtube.com', async () => {
        calledAt.push(Date.now())
      }),
    )

    // Flush microtasks without advancing time at all: only the first, unblocked call should
    // have run. If this were 20, the limiter isn't spacing anything.
    await vi.advanceTimersByTimeAsync(0)
    expect(calledAt).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(20 * 200)
    await Promise.all(tasks)

    expect(calledAt).toHaveLength(20)
    for (let i = 1; i < calledAt.length; i++) {
      expect(calledAt[i]! - calledAt[i - 1]!).toBeGreaterThanOrEqual(200)
    }
  })

  it('applies a per-domain override interval instead of the default', async () => {
    const limiter = new DomainRateLimiter({
      minIntervalMs: 50,
      perDomainMinIntervalMs: { 'export.arxiv.org': 3000 },
    })
    const calledAt: number[] = []
    const tasks = Array.from({ length: 3 }, () =>
      limiter.schedule('export.arxiv.org', async () => {
        calledAt.push(Date.now())
      }),
    )

    await vi.advanceTimersByTimeAsync(3000 * 2 + 100)
    await Promise.all(tasks)

    expect(calledAt[1]! - calledAt[0]!).toBeGreaterThanOrEqual(3000)
    expect(calledAt[2]! - calledAt[1]!).toBeGreaterThanOrEqual(3000)
  })

  it('does not block one domain on another', async () => {
    const limiter = new DomainRateLimiter({ minIntervalMs: 5000 })
    const order: string[] = []

    const youtube = limiter.schedule('youtube.com', async () => {
      order.push('youtube')
    })
    const github = limiter.schedule('github.com', async () => {
      order.push('github')
    })

    // Both are the first call for their own domain, so neither should wait on the other's
    // (very long) 5s interval.
    await vi.advanceTimersByTimeAsync(0)
    await Promise.all([youtube, github])

    expect(order).toContain('youtube')
    expect(order).toContain('github')
  })
})

describe('withRetry', () => {
  it('retries a transient failure and resolves once the function succeeds', async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls += 1
      if (calls < 3) throw new Error('transient')
      return 'ok'
    })

    const result = await withRetry(fn, { maxAttempts: 3, sleep: async () => {} })

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws the last error after exhausting maxAttempts', async () => {
    const fn = vi.fn(async () => {
      throw new Error('always fails')
    })

    await expect(withRetry(fn, { maxAttempts: 3, sleep: async () => {} })).rejects.toThrow('always fails')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry at all when isRetryable returns false', async () => {
    const fn = vi.fn(async () => {
      throw new Error('permanent failure')
    })

    await expect(
      withRetry(fn, { maxAttempts: 5, isRetryable: () => false, sleep: async () => {} }),
    ).rejects.toThrow('permanent failure')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('waits with exponential backoff between attempts', async () => {
    const delays: number[] = []
    const fn = vi.fn(async () => {
      throw new Error('x')
    })

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 100,
        sleep: async (ms) => {
          delays.push(ms)
        },
      }),
    ).rejects.toThrow()

    // 3 attempts -> 2 waits, doubling: 100, then 200.
    expect(delays).toEqual([100, 200])
  })

  it('caps backoff delay at maxDelayMs', async () => {
    const delays: number[] = []
    const fn = vi.fn(async () => {
      throw new Error('x')
    })

    await expect(
      withRetry(fn, {
        maxAttempts: 4,
        baseDelayMs: 1000,
        maxDelayMs: 1500,
        sleep: async (ms) => {
          delays.push(ms)
        },
      }),
    ).rejects.toThrow()

    // Uncapped would be 1000, 2000, 4000 — the second and third must clamp to 1500.
    expect(delays).toEqual([1000, 1500, 1500])
  })
})

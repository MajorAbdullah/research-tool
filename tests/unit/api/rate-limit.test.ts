import { describe, expect, it } from 'vitest'
import { createRateLimiter } from '@/services/rate-limit'

describe('createRateLimiter', () => {
  it('allows up to the limit within one window', () => {
    const limiter = createRateLimiter(3, 60_000)
    const now = 1_000_000

    expect(limiter.check('token-a', now).allowed).toBe(true)
    expect(limiter.check('token-a', now).allowed).toBe(true)
    expect(limiter.check('token-a', now).allowed).toBe(true)
    const fourth = limiter.check('token-a', now)
    expect(fourth.allowed).toBe(false)
    expect(fourth.retryAfterSec).toBeGreaterThan(0)
  })

  it('tracks separate keys independently', () => {
    const limiter = createRateLimiter(1, 60_000)
    const now = 1_000_000
    expect(limiter.check('a', now).allowed).toBe(true)
    expect(limiter.check('b', now).allowed).toBe(true) // different key, its own budget
    expect(limiter.check('a', now).allowed).toBe(false)
  })

  it('resets once the window has elapsed', () => {
    const limiter = createRateLimiter(1, 1_000)
    const now = 1_000_000
    expect(limiter.check('a', now).allowed).toBe(true)
    expect(limiter.check('a', now + 500).allowed).toBe(false)
    expect(limiter.check('a', now + 1_001).allowed).toBe(true)
  })
})

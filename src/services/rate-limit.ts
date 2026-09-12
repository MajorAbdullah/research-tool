/**
 * Fixed-window rate limiter for `POST /api/v1/capture` (docs/API.md §1.7: "60 requests/min per
 * token"). Only ever applied to bearer-token callers (the extension/PWA) — see
 * `auth-context.ts` — since that token is the one long-lived credential exposed to a non-browser
 * caller and the one most at risk if it leaks; a session-cookie caller isn't rate-limited here.
 *
 * Plain in-memory state, deliberately: Sieve is one process, one container (ADR 0007) with no
 * shared cache to coordinate through, and CLAUDE.md's default is "the simplest thing that solves
 * the actual, current requirement" — a `Map` reset on restart is exactly that requirement, not a
 * gap to fill with Redis. `createRateLimiter` is exported (rather than only a singleton) so tests
 * get an isolated instance instead of fighting shared module state.
 */

export interface RateLimitResult {
  allowed: boolean
  /** Seconds until the current window resets — only meaningful when `allowed` is false. */
  retryAfterSec: number
}

export interface RateLimiter {
  check(key: string, now?: number): RateLimitResult
}

interface Window {
  count: number
  resetAt: number
}

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const windows = new Map<string, Window>()

  return {
    check(key, now = Date.now()) {
      let window = windows.get(key)
      if (!window || now >= window.resetAt) {
        window = { count: 0, resetAt: now + windowMs }
        windows.set(key, window)
      }

      window.count += 1

      if (window.count > limit) {
        return {
          allowed: false,
          retryAfterSec: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
        }
      }
      return { allowed: true, retryAfterSec: 0 }
    },
  }
}

const CAPTURE_RATE_LIMIT = 60
const CAPTURE_RATE_WINDOW_MS = 60_000

/** The app-wide limiter backing `POST /api/v1/capture`'s bearer-token path. */
export const captureRateLimiter: RateLimiter = createRateLimiter(
  CAPTURE_RATE_LIMIT,
  CAPTURE_RATE_WINDOW_MS,
)

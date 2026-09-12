/**
 * The one fake used by every extractor test (qa-testing-best-practices.md: "keep fakes/mocks for
 * third-party services in one shared place"). `HttpClient` (src/lib/extractors/http.ts) is the
 * architectural boundary every extractor's network call goes through, so faking it here means the
 * extractor tests exercise real extraction logic (Readability, PDF parsing, the ladder, JSON
 * decoding...) against real recorded fixture bytes, with zero actual network access.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { HttpClient, HttpResponse } from '@/lib/extractors/http'

const FIXTURES_ROOT = fileURLToPath(new URL('../../../fixtures/extractors/', import.meta.url))

export function fixtureBuffer(relativePath: string): Buffer {
  return readFileSync(`${FIXTURES_ROOT}${relativePath}`)
}

export function fixtureText(relativePath: string): string {
  return readFileSync(`${FIXTURES_ROOT}${relativePath}`, 'utf-8')
}

export type FakeHttpOutcome =
  | { kind: 'response'; status?: number; headers?: Record<string, string>; body: Buffer | string }
  | { kind: 'error'; message: string }

export interface FakeHttpRoute {
  /** Matched against the request URL — a substring (string) or a RegExp. */
  match: string | RegExp
  /**
   * Consumed in order for successive calls that match this route; the last entry repeats once
   * exhausted (so a route with one outcome just always returns it).
   */
  outcomes: FakeHttpOutcome[]
}

/** Convenience for the common case: one route, one fixed outcome, always ok:true, status 200. */
export function respondWith(body: Buffer | string, extra: Partial<Extract<FakeHttpOutcome, { kind: 'response' }>> = {}): FakeHttpOutcome {
  return { kind: 'response', body, ...extra }
}

export function networkError(message: string): FakeHttpOutcome {
  return { kind: 'error', message }
}

export interface FakeHttpCall {
  url: string
}

/**
 * Builds a fake `HttpClient` from an ordered list of routes, matched first-match-wins. Throws
 * (loudly, in the test itself, not swallowed) if a request doesn't match any route — an
 * unexpected outbound call is a bug in the test's fixture setup, not something to silently no-op.
 */
export function createFakeHttpClient(routes: FakeHttpRoute[], calls: FakeHttpCall[] = []): HttpClient {
  const cursor = new Map<FakeHttpRoute, number>()

  return {
    async request(url): Promise<HttpResponse> {
      calls.push({ url })

      const route = routes.find((candidate) =>
        typeof candidate.match === 'string' ? url.includes(candidate.match) : candidate.match.test(url),
      )
      if (!route) {
        throw new Error(`createFakeHttpClient: no route matched request URL: ${url}`)
      }

      const index = cursor.get(route) ?? 0
      cursor.set(route, index + 1)
      const outcome = route.outcomes[Math.min(index, route.outcomes.length - 1)]
      if (!outcome) {
        throw new Error(`createFakeHttpClient: route for ${String(route.match)} has no outcomes configured`)
      }

      if (outcome.kind === 'error') {
        throw new Error(outcome.message)
      }

      const status = outcome.status ?? 200
      const body = typeof outcome.body === 'string' ? Buffer.from(outcome.body, 'utf-8') : outcome.body
      return {
        status,
        ok: status >= 200 && status < 300,
        headers: outcome.headers ?? {},
        body,
      }
    },
  }
}

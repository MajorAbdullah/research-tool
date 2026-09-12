/**
 * The one architectural boundary every extractor's outbound network call goes through. Real
 * extractors get `createHttpClient()` by default (undici + per-domain rate limiting + retry with
 * backoff); tests construct extractors with a fake `HttpClient` instead (see
 * tests/unit/extractors/helpers/fake-http.ts) so the extractor test suite never touches the
 * network — see CLAUDE.md / qa-testing-best-practices.md, "mock at architectural boundaries."
 *
 * `request()` only *throws* for transport-level failures (DNS, connection reset, timeout) — an
 * HTTP-level error status (404, 429, 500...) comes back as a normal response with `ok: false`.
 * That split matters: retrying a dropped connection is almost always right, but retrying a 404 or
 * a "rate limit exceeded, reset in 40 minutes" response never is. Each extractor decides what an
 * error status means for it (GitHub: throw with the rate-limit reset time; YouTube: fall through
 * to the next rung) — see errors.ts.
 */
import { request as undiciRequest } from 'undici'
import { ExtractionError } from './errors'
import { DomainRateLimiter, withRetry } from './rate-limit'

export interface HttpResponse {
  status: number
  ok: boolean
  /** Lowercase header names, multi-value headers joined with ", " — plain object, easy to fake. */
  headers: Record<string, string>
  body: Buffer
}

export interface HttpRequestOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  /** Every call has one — a hung provider must never hang the caller. */
  timeoutMs?: number
}

export interface HttpClient {
  request(url: string, options?: HttpRequestOptions): Promise<HttpResponse>
}

export const DEFAULT_TIMEOUT_MS = 8000

// Shared across every extractor's *default* HttpClient, so "20 queued YouTube URLs" are spaced
// against one clock per domain rather than one clock per extractor instance. Tests never reach
// this — they construct extractors with a fake HttpClient (see helpers/fake-http.ts), so the
// extractor suite stays instant regardless of what this default does.
const sharedRateLimiter = new DomainRateLimiter({
  perDomainMinIntervalMs: {
    // arXiv's API terms of use ask for no more than one request per 3 seconds.
    'export.arxiv.org': 3000,
  },
})

export interface CreateHttpClientOptions {
  rateLimiter?: DomainRateLimiter
}

export function createHttpClient(options: CreateHttpClientOptions = {}): HttpClient {
  const rateLimiter = options.rateLimiter ?? sharedRateLimiter

  return {
    request(url, requestOptions = {}) {
      const domain = safeHostname(url)
      return rateLimiter.schedule(domain, () =>
        withRetry(() => performRequest(url, requestOptions), {
          isRetryable: (err) => err instanceof ExtractionError && err.retryable,
        }),
      )
    },
  }
}

async function performRequest(url: string, options: HttpRequestOptions): Promise<HttpResponse> {
  const { method = 'GET', headers, timeoutMs = DEFAULT_TIMEOUT_MS } = options

  let statusCode: number
  let rawHeaders: Record<string, string | string[] | undefined>
  let bodyBuffer: Buffer
  try {
    const res = await undiciRequest(url, {
      method,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
    statusCode = res.statusCode
    rawHeaders = res.headers
    bodyBuffer = Buffer.from(await res.body.arrayBuffer())
  } catch (err) {
    throw new ExtractionError(
      'network_error',
      `Request to ${safeUrl(url)} failed: ${describeError(err)}`,
      {
        retryable: true,
        cause: err,
      },
    )
  }

  return {
    status: statusCode,
    ok: statusCode >= 200 && statusCode < 300,
    headers: normalizeHeaders(rawHeaders),
    body: bodyBuffer,
  }
}

function normalizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
  }
  return normalized
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function safeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch {
    return '[unparseable url]'
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'unknown'
  }
}

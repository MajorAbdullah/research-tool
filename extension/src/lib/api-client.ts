/**
 * The only module that talks to the Sieve server. Every request:
 *  - sends `Authorization: Bearer <EXTENSION_TOKEN>` (docs/API.md §1.2 — the
 *    extension is a bearer-token caller, never a session-cookie one), and
 *  - on failure, surfaces `error.message` from docs/API.md §1.5's error
 *    envelope — which the contract guarantees is display-safe — and NEVER a
 *    raw exception message from anywhere the server might have failed
 *    unexpectedly.
 */

import type { ApiErrorBody, CaptureRequest, CaptureResponse, HealthResponse } from './types'

export interface SieveConnection {
  serverUrl: string
  token: string
}

/** Thrown for any failure talking to Sieve. `.message` is always safe to show a user directly. */
export class SieveApiError extends Error {
  readonly code: string
  readonly requestId: string | null

  constructor(message: string, code: string, requestId: string | null) {
    super(message)
    this.name = 'SieveApiError'
    this.code = code
    this.requestId = requestId
  }
}

function joinUrl(serverUrl: string, path: string): string {
  return `${serverUrl.replace(/\/+$/, '')}${path}`
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false
  const error = (value as { error?: unknown }).error
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { message?: unknown }).message === 'string' &&
    typeof (error as { code?: unknown }).code === 'string'
  )
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export async function checkHealth(
  connection: SieveConnection,
): Promise<{ ok: true } | { ok: false; message: string }> {
  let response: Response
  try {
    response = await fetch(joinUrl(connection.serverUrl, '/api/v1/health'), { method: 'GET' })
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? `Could not reach the server: ${err.message}`
          : 'Could not reach the server.',
    }
  }

  const body = await parseJsonSafely(response)

  if (!response.ok) {
    if (isApiErrorBody(body)) return { ok: false, message: body.error.message }
    return { ok: false, message: `Server responded with HTTP ${response.status}.` }
  }

  const health = body as Partial<HealthResponse> | null
  if (health?.status === 'ok') return { ok: true }
  return { ok: false, message: `Server reports status "${health?.status ?? 'unknown'}".` }
}

export async function capture(
  connection: SieveConnection,
  request: CaptureRequest,
): Promise<CaptureResponse> {
  let response: Response
  try {
    response = await fetch(joinUrl(connection.serverUrl, '/api/v1/capture'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${connection.token}`,
      },
      body: JSON.stringify(request),
    })
  } catch (err) {
    // A network-level failure (DNS, connection refused, CORS, offline) never
    // reaches the server, so there is no error.message to surface — this is
    // our own message, not a leaked internal, and it is display-safe.
    throw new SieveApiError(
      err instanceof Error
        ? `Could not reach the Sieve server: ${err.message}`
        : 'Could not reach the Sieve server.',
      'NETWORK_ERROR',
      null,
    )
  }

  const body = await parseJsonSafely(response)

  if (!response.ok) {
    if (isApiErrorBody(body)) {
      throw new SieveApiError(body.error.message, body.error.code, body.error.request_id)
    }
    // Malformed/absent error body from a non-2xx response — still never show
    // raw status text or a stack; fall back to a generic, safe message.
    throw new SieveApiError('Something went wrong. Try again.', 'UNKNOWN', null)
  }

  return body as CaptureResponse
}

/** Human-readable, display-safe message for any error thrown by this module or its callers. */
export function describeError(err: unknown): string {
  if (err instanceof SieveApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Something went wrong. Try again.'
}

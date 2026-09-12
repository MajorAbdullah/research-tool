/**
 * Structured logging (pino) — the one logger instance the app uses. Job/item correlation ids
 * are threaded in by callers via `.child({...})`, not baked in here (this module doesn't know
 * about jobs or items; the worker loop attaches those fields — see `src/worker/loop.ts`).
 *
 * CLAUDE.md non-negotiable: "Never log secrets, tokens, or PII." `redact` is the backstop for
 * that — it fires even if some future call site accidentally logs a whole config/request-headers
 * object instead of picking specific fields.
 */

import pino from 'pino'

const REDACT_PATHS = [
  // Common secret-shaped field names, wherever they appear in a logged object.
  '*.password',
  '*.passwordHash',
  '*.password_hash',
  '*.token',
  '*.secret',
  '*.authorization',
  '*.Authorization',
  '*.authSecret',
  '*.extensionToken',
  '*.openRouterApiKey',
  '*.githubPat',
  // Nested one level deeper — e.g. a logged `{ req: { headers: {...} } }`.
  '*.*.password',
  '*.*.token',
  '*.*.secret',
  '*.*.authorization',
  '*.*.Authorization',
]

const isProduction = process.env.NODE_ENV === 'production'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  // Pretty-print in dev for a human terminal; ship raw NDJSON in production for log collectors.
  transport: isProduction ? undefined : { target: 'pino-pretty', options: { colorize: true } },
})

export type Logger = typeof logger

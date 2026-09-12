/**
 * Helpers around `ClientCapture` (`{html?, transcript?, caption?}`, src/types/contracts.ts) — the
 * client-captured content `capture` and `retry` both accept and forward to the extract stage.
 *
 * Storage decision (see this phase's final report for the full reasoning): there is no dedicated
 * column for this on `items` — `schema.ts` is frozen/out of this phase's scope — so the freshest
 * known client capture is kept in `items.raw_payload` (a JSON `unknown` column) under a
 * namespaced `clientCapture` key, merged rather than overwritten wholesale so a later stage
 * writing its own data into the same column (e.g. an extractor's raw API response) doesn't
 * require coordination with this phase to avoid clobbering it.
 */

import type { ClientCapture } from '@/types/contracts'

/** `true` if at least one of html/transcript/caption is a non-empty string. */
export function hasAnyHint(hint: ClientCapture): boolean {
  return Boolean(hint.html || hint.transcript || hint.caption)
}

/** Picks only the defined, non-empty fields off a request body shaped like `ClientCapture`. */
export function pickHint(input: {
  html?: string
  transcript?: string
  caption?: string
}): ClientCapture {
  const hint: ClientCapture = {}
  if (input.html) hint.html = input.html
  if (input.transcript) hint.transcript = input.transcript
  if (input.caption) hint.caption = input.caption
  return hint
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads the previously-stored client capture out of an item's `raw_payload`, if any. */
export function readStoredClientCapture(rawPayload: unknown): ClientCapture {
  if (!isPlainObject(rawPayload)) return {}
  const stored = rawPayload.clientCapture
  if (!isPlainObject(stored)) return {}
  const result: ClientCapture = {}
  if (typeof stored.html === 'string') result.html = stored.html
  if (typeof stored.transcript === 'string') result.transcript = stored.transcript
  if (typeof stored.caption === 'string') result.caption = stored.caption
  return result
}

/**
 * Merges a fresh hint over whatever was already stored (fresh fields win, per-field — a request
 * that only supplies `caption` must not erase a previously-captured `transcript`) and returns the
 * updated `raw_payload` to persist. Preserves any other keys already on `raw_payload` untouched.
 */
export function mergeClientCaptureIntoRawPayload(
  existingRawPayload: unknown,
  freshHint: ClientCapture,
): Record<string, unknown> {
  const base = isPlainObject(existingRawPayload) ? existingRawPayload : {}
  const stored = readStoredClientCapture(existingRawPayload)
  return { ...base, clientCapture: { ...stored, ...freshHint } }
}

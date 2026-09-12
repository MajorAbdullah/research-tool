/**
 * Server-Sent Events framing (docs/API.md §3.8). One tiny pure function so the exact wire format
 * is unit-tested directly, instead of only ever being exercised through a live `ReadableStream`.
 */

/** `event: <name>\ndata: <json>\n\n` — the blank line is the SSE frame terminator; every event
 *  this API emits carries exactly one JSON `data` line, never a multi-line payload. */
export function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

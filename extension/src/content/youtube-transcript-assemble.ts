/**
 * Pure DOM -> text assembly for YouTube's transcript panel. This is the
 * single highest-value function in the extension (docs/adr/0006: client-side
 * transcript capture is the only reliable path to full YouTube transcripts,
 * since the server's own datacenter IP gets blocked after ~100-200 requests)
 * — so it is deliberately over-commented. Read this whole comment block
 * before touching the selectors below.
 *
 * ============================================================================
 * DOM ASSUMPTIONS — verified LIVE against youtube.com on 2026-09-12
 * ============================================================================
 * Verified by loading https://www.youtube.com/watch?v=dQw4w9WgXcQ (the same
 * video used in docs/API.md's own curl example, chosen for that reason) in a
 * real browser and inspecting the transcript panel after opening it.
 *
 * MODERN layout (what was actually observed live, 2026-09-12):
 *   Each transcript line is a `<transcript-segment-view-model>` custom
 *   element (YouTube's newer "view model" web-component architecture, a
 *   different naming scheme from the older `ytd-*-renderer` Polymer
 *   components). Its children:
 *     - `.ytwTranscriptSegmentViewModelTimestamp`
 *         The human-readable "m:ss" label (e.g. "0:18"). `aria-hidden="true"`.
 *     - `.ytwTranscriptSegmentViewModelTimestampA11yLabel`
 *         A spoken-word duration ("18 seconds"), accessibility-only. Not
 *         used — it's redundant with the timestamp and not machine-parseable
 *         back into a clock time without extra work.
 *     - `span[role="text"]` (class `ytAttributedStringHost ...`)
 *         The actual caption text for that line.
 *   IMPORTANT: do not use `segmentEl.textContent` — it concatenates the
 *   timestamp label, the a11y label, AND the text with no separator, e.g.
 *   `"0:1818 seconds♪ We're no strangers to love ♪ ..."`. You must read the
 *   timestamp and text sub-elements separately, which is exactly what
 *   `readSegment()` below does.
 *
 * LEGACY layout (NOT observed live this session — kept as a fallback since
 * YouTube has historically run old and new UI concurrently mid-rollout, and
 * multiple community write-ups from before this date describe it):
 *   `<ytd-transcript-segment-renderer>` containing `.segment-timestamp` and
 *   `.segment-text`.
 *
 * Other things confirmed live, which the *orchestration* code in
 * `youtube-transcript.ts` (not this file) depends on:
 *   - The panel's `target-id` attribute was `"PAmodern_transcript_view"` —
 *     NOT `"engagement-panel-searchable-transcript"`, which is what older
 *     community references (and an earlier draft of this extractor) assumed.
 *     This had ALREADY changed by the time this was checked. Don't
 *     hardcode a `target-id` value as your primary detection strategy;
 *     `youtube-transcript.ts` instead finds the panel via its visible header
 *     text ("Transcript") plus a `visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"`
 *     check, which is far more likely to survive the next rename.
 *   - TWO near-identical `button[aria-label="Show transcript"]` elements
 *     existed in the same page simultaneously (apparently duplicate markup
 *     for an alternate layout state). Only one of them actually opened the
 *     panel when clicked.
 *   - The transcript panel shell can expand before the segment list has
 *     loaded (a spinner + an empty Polymer `dom-repeat` template render
 *     first; YouTube fetches the segment list as a separate continuation
 *     request after the panel opens) — reading immediately after clicking
 *     "Show transcript" can see zero segments even though the click worked.
 *     Poll/wait for at least one segment element, don't assume synchronous.
 *
 * ============================================================================
 * IF THIS BREAKS — re-check here first
 * ============================================================================
 * 1. Open any YouTube video with captions in a real browser.
 * 2. Click "Show transcript" (below the video, near the description).
 * 3. Open devtools, inspect one line in the transcript panel on the right.
 * 4. Compare against MODERN_SEGMENT_SELECTOR / MODERN_TIMESTAMP_SELECTOR /
 *    MODERN_TEXT_SELECTOR below. Update them (and this comment, with
 *    today's date) if YouTube has changed the markup again.
 * 5. If the button itself is gone/renamed, update `findOpenTranscriptButtons`
 *    in `youtube-transcript.ts`.
 *
 * Known limitation: the "Show transcript" text/aria-label match is
 * English-only. A YouTube account set to another display language will use a
 * translated label this code will not recognize, and the extractor will
 * report `no_transcript_button` even though a transcript exists. There is no
 * clean fix short of hardcoding per-language strings (fragile in a different
 * way) or matching on something structural instead of text — left as a
 * known gap rather than a half solution.
 */

export interface TranscriptSegment {
  timestamp: string
  text: string
}

const MODERN_SEGMENT_SELECTOR = 'transcript-segment-view-model'
const MODERN_TIMESTAMP_SELECTOR = '.ytwTranscriptSegmentViewModelTimestamp'
const MODERN_TEXT_SELECTOR = 'span[role="text"]'

const LEGACY_SEGMENT_SELECTOR = 'ytd-transcript-segment-renderer'
const LEGACY_TIMESTAMP_SELECTOR = '.segment-timestamp'
const LEGACY_TEXT_SELECTOR = '.segment-text'

/** Every segment element currently in `root`, modern layout preferred over legacy. */
export function getSegmentElements(root: ParentNode): Element[] {
  const modern = Array.from(root.querySelectorAll(MODERN_SEGMENT_SELECTOR))
  if (modern.length > 0) return modern
  return Array.from(root.querySelectorAll(LEGACY_SEGMENT_SELECTOR))
}

/** Pulls {timestamp, text} out of one segment element, trying modern then legacy sub-selectors. */
export function readSegment(el: Element): TranscriptSegment | null {
  const modernTimestamp = el.querySelector(MODERN_TIMESTAMP_SELECTOR)
  const modernText = el.querySelector(MODERN_TEXT_SELECTOR)
  if (modernTimestamp && modernText) {
    const text = (modernText.textContent ?? '').trim()
    if (text) return { timestamp: (modernTimestamp.textContent ?? '').trim(), text }
  }

  const legacyTimestamp = el.querySelector(LEGACY_TIMESTAMP_SELECTOR)
  const legacyText = el.querySelector(LEGACY_TEXT_SELECTOR)
  if (legacyTimestamp && legacyText) {
    const text = (legacyText.textContent ?? '').trim()
    if (text) return { timestamp: (legacyTimestamp.textContent ?? '').trim(), text }
  }

  return null
}

/**
 * Assembles the full timestamped transcript text from a transcript-panel
 * root element (or any ancestor containing the segment elements) — the
 * format matches docs/API.md's own example: `"[0:18] ♪ We're no strangers..."`.
 * Returns an empty string if no segments are found; callers decide whether
 * that means "no captions" or "not loaded yet" (see youtube-transcript.ts).
 */
export function assembleTranscript(root: ParentNode): string {
  const lines: string[] = []
  for (const el of getSegmentElements(root)) {
    const segment = readSegment(el)
    if (segment) lines.push(`[${segment.timestamp}] ${segment.text}`)
  }
  return lines.join('\n')
}

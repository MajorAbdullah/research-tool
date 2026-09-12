/**
 * Orchestration for the YouTube transcript scraper: finds/opens the
 * transcript panel, waits for it to actually populate, and guards against
 * the SPA-navigation race, then delegates to the pure assembler in
 * `youtube-transcript-assemble.ts` (see that file for the DOM assumptions
 * this depends on and how to re-verify them).
 *
 * Not unit tested (it drives real timers/clicks against `document`) — the
 * assembly logic it calls into is what's covered in
 * tests/unit/youtube-transcript.test.ts.
 */

import { assembleTranscript, getSegmentElements } from './youtube-transcript-assemble'

export type YouTubeTranscriptFailureReason =
  'no_transcript_button' | 'panel_did_not_open' | 'empty_after_open' | 'navigated_away'

export interface YouTubeTranscriptResult {
  transcript: string | null
  reason?: YouTubeTranscriptFailureReason
}

function getVideoId(): string | null {
  return new URLSearchParams(location.search).get('v')
}

/**
 * Finds the transcript engagement panel IF it is currently expanded.
 *
 * Deliberately identifies it by its visible header text ("Transcript"),
 * not by the panel's `target-id` attribute — that attribute was observed to
 * already differ from what older public references describe (see the
 * comment block in youtube-transcript-assemble.ts), so it is not a
 * trustworthy long-term anchor. There can be more than one
 * `<ytd-engagement-panel-section-list-renderer>` with a "Transcript" header
 * in the DOM at once (a duplicate for another layout state was observed
 * live); `offsetParent` filters down to the one actually on screen.
 */
function findExpandedTranscriptPanel(): Element | null {
  const titles = Array.from(document.querySelectorAll('h2[aria-label="Transcript" i]'))
  const visibleTitle = titles.find((title) => (title as HTMLElement).offsetParent !== null)
  if (!visibleTitle) return null

  const panel = visibleTitle.closest('ytd-engagement-panel-section-list-renderer')
  if (!panel) return null

  return panel.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED' ? panel : null
}

/**
 * Buttons that open the transcript panel. Exact aria-label match first
 * (confirmed live: `"Show transcript"`); a looser substring fallback second,
 * in case YouTube tweaks the exact wording without removing the concept
 * entirely. Excludes anything whose label suggests it *closes* the panel,
 * since a same-labelled toggle button showing up in this scan would just
 * close what we're trying to open.
 */
function findOpenTranscriptButtons(): HTMLElement[] {
  const exact = Array.from(
    document.querySelectorAll<HTMLElement>('button[aria-label="Show transcript"]'),
  )
  if (exact.length > 0) return exact

  return Array.from(document.querySelectorAll<HTMLElement>('button')).filter((button) => {
    const label = (button.getAttribute('aria-label') ?? '').toLowerCase()
    return label.includes('transcript') && !label.includes('close') && !label.includes('hide')
  })
}

async function waitFor<T>(
  probe: () => T | null,
  timeoutMs: number,
  intervalMs = 200,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = probe()
    if (result) return result
    if (Date.now() >= deadline) return probe()
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/**
 * Scrapes the transcript for whatever video is currently open. Handles all
 * three cases required by the task brief:
 *  - no transcript button at all (video has no captions to show) —
 *    `reason: 'no_transcript_button'`;
 *  - the panel is already open (user opened it themselves, or a previous
 *    capture on this same video left it open) — skips the click entirely;
 *  - YouTube's SPA navigation between videos without a page reload — guarded
 *    by comparing the `v=` query param before and after waiting, so a
 *    transcript never gets attached to the wrong video's URL.
 */
export async function scrapeYouTubeTranscript(): Promise<YouTubeTranscriptResult> {
  const videoIdAtStart = getVideoId()

  let panel = findExpandedTranscriptPanel()

  if (!panel) {
    const buttons = findOpenTranscriptButtons()
    if (buttons.length === 0) {
      return { transcript: null, reason: 'no_transcript_button' }
    }

    // More than one matching button has been observed in the live DOM at
    // once; try each until the panel actually expands, since clicking an
    // inert duplicate is a silent no-op, not an error, from `.click()`'s
    // point of view.
    for (const button of buttons) {
      button.click()
      panel = await waitFor(findExpandedTranscriptPanel, 4_000)
      if (panel) break
    }

    if (!panel) {
      return { transcript: null, reason: 'panel_did_not_open' }
    }
  }

  const expandedPanel = panel
  const segmentsReady = await waitFor(
    () => (getSegmentElements(expandedPanel).length > 0 ? true : null),
    6_000,
  )

  // SPA-navigation guard: if the user clicked through to a different video
  // while we were waiting (no full page reload happens on YouTube between
  // videos), bail out rather than silently attaching the wrong transcript.
  if (getVideoId() !== videoIdAtStart) {
    return { transcript: null, reason: 'navigated_away' }
  }

  if (!segmentsReady) {
    return { transcript: null, reason: 'empty_after_open' }
  }

  const transcript = assembleTranscript(expandedPanel)
  if (!transcript) {
    return { transcript: null, reason: 'empty_after_open' }
  }

  return { transcript }
}

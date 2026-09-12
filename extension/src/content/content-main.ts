/**
 * The one content-script entry point, injected on demand via
 * `chrome.scripting.executeScript({ files: ['content-main.js'] })` (see
 * src/background/service-worker.ts). Never statically declared in
 * manifest.json as a `content_scripts` entry — deliberately, so the
 * extension holds no standing per-site permission at all; it only ever
 * touches a page for the few seconds around a user-triggered capture (see
 * the README's "Permissions" section for the full reasoning).
 *
 * Dispatches by hostname/path to the right extractor, then messages the
 * result back to the background service worker (rather than relying on
 * `executeScript`'s completion-value return, which is less predictable for
 * a bundled, non-trivial script than for a small inline function — see
 * vite.config.ts's comment on why this is built as a plain IIFE, not an ES
 * module).
 */

import { captureOuterHtml } from './dom-capture'
import { formatCaptureCaption, grabInstagramReel } from './instagram-reel'
import { scrapeYouTubeTranscript } from './youtube-transcript'
import { walkXThread } from './x-thread'

export interface ContentCaptureResult {
  title: string
  html?: string
  transcript?: string
  caption?: string
}

function isYouTubeWatchPage(): boolean {
  return /(^|\.)youtube\.com$/.test(location.hostname) && location.pathname === '/watch'
}

function isXOrThreadsPage(): boolean {
  return /(^|\.)(x\.com|twitter\.com)$/.test(location.hostname)
}

function isInstagramPage(): boolean {
  return /(^|\.)instagram\.com$/.test(location.hostname)
}

async function run(): Promise<ContentCaptureResult> {
  const title = document.title

  if (isYouTubeWatchPage()) {
    const { transcript } = await scrapeYouTubeTranscript()
    // No `html` here on purpose: a YouTube watch page's outerHTML is huge
    // and dominated by chrome/scripts/other-video recommendations, not
    // article-like content — the transcript is the whole point (matches
    // docs/API.md's own capture example, which sends `transcript` only for
    // a YouTube URL).
    return { title, ...(transcript ? { transcript } : {}) }
  }

  if (isXOrThreadsPage()) {
    const html = walkXThread()
    return { title, ...(html ? { html } : {}) }
  }

  if (isInstagramPage()) {
    const caption = formatCaptureCaption(grabInstagramReel())
    return { title, ...(caption ? { caption } : {}) }
  }

  return { title, html: captureOuterHtml() }
}

function sendResult(message: {
  type: 'sieve:content-capture-result'
  result: ContentCaptureResult
}): void {
  void chrome.runtime.sendMessage(message)
}

function sendError(error: string): void {
  void chrome.runtime.sendMessage({ type: 'sieve:content-capture-error', error })
}

run()
  .then((result) => sendResult({ type: 'sieve:content-capture-result', result }))
  .catch((err: unknown) => {
    sendError(
      err instanceof Error ? err.message : 'Capture failed on the page for an unknown reason.',
    )
  })

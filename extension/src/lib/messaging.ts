/**
 * Typed message contracts passed through `chrome.runtime.sendMessage` /
 * `chrome.runtime.onMessage`. Kept in one place so background, content and
 * popup scripts agree on shapes without importing each other's modules
 * (they run in separate JS contexts — content scripts especially cannot
 * import from background/popup at runtime).
 */

import type { ContentCaptureResult } from '../content/content-main'

/** Sent from an injected content-main.js back to the background service worker. */
export type ContentCaptureMessage =
  | { type: 'sieve:content-capture-result'; result: ContentCaptureResult }
  | { type: 'sieve:content-capture-error'; error: string }

export function isContentCaptureMessage(value: unknown): value is ContentCaptureMessage {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as { type?: unknown }).type
  return type === 'sieve:content-capture-result' || type === 'sieve:content-capture-error'
}

/** Sent from the popup to the background service worker to trigger a capture with an optional note. */
export interface PopupSaveMessage {
  type: 'sieve:popup-save'
  tabId: number
  note?: string
}

export function isPopupSaveMessage(value: unknown): value is PopupSaveMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'sieve:popup-save' &&
    typeof (value as { tabId?: unknown }).tabId === 'number'
  )
}

/** Background's reply to a PopupSaveMessage. */
export type PopupSaveReply =
  | { ok: true; id: string; duplicate: boolean; truncated: boolean }
  | { ok: false; message: string }

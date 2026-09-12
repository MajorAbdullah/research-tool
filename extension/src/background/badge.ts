/**
 * Toolbar badge feedback. Every capture path (toolbar/popup, keyboard
 * shortcut, context menu) must show ✓/✗ within ~2s — a failed capture is
 * never allowed to fail silently (task brief's hard requirement).
 *
 * The auto-clear timer uses a plain `setTimeout`, not `chrome.alarms` — MV3
 * service workers can be suspended when idle, which would in principle drop
 * a pending `setTimeout`. Using `alarms` instead would survive that, at the
 * cost of an extra manifest permission purely for a several-second cosmetic
 * badge-clear. Given the service worker stays alive for a few seconds after
 * any recent activity (which a just-finished capture always is), this is a
 * deliberate least-privilege trade: worst case, a badge occasionally lingers
 * a bit longer than intended — never a correctness issue, so not worth the
 * extra permission.
 */

import { BADGE_CLEAR_DELAY_MS } from '../lib/constants'

let clearTimer: ReturnType<typeof setTimeout> | undefined

function scheduleClear(): void {
  if (clearTimer) clearTimeout(clearTimer)
  clearTimer = setTimeout(() => {
    void chrome.action.setBadgeText({ text: '' })
  }, BADGE_CLEAR_DELAY_MS)
}

export async function showSuccessBadge(): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: '#16a34a' })
  await chrome.action.setBadgeText({ text: '✓' }) // ✓
  scheduleClear()
}

export async function showFailureBadge(): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' })
  await chrome.action.setBadgeText({ text: '✗' }) // ✗
  scheduleClear()
}

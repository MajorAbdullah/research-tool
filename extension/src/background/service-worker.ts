/**
 * MV3 service worker — the one place that actually talks to `/api/v1/capture`.
 * Wires together the three capture surfaces:
 *   - keyboard shortcut (`commands.onCommand`) — instant capture, no dialog;
 *   - toolbar icon click — opens popup.html (P4.1.4's note/topic-hint UI),
 *     which sends this worker a `sieve:popup-save` message when the user
 *     clicks Save;
 *   - right-click "Save link to Sieve" on an anchor (`contextMenus`) —
 *     saves the link's target href, never the current page, and never
 *     injects into the target at all (see `handleContextMenuCapture`).
 *
 * All three end up in `performCapture`, so behavior (auth header, payload
 * cap, badge, error surfacing) is identical regardless of entry point.
 */

import { capture, describeError, type SieveConnection } from '../lib/api-client'
import { CONTENT_SCRIPT_TIMEOUT_MS } from '../lib/constants'
import { ensureServerOriginPermission } from '../lib/host-permission'
import { isContentCaptureMessage, isPopupSaveMessage, type PopupSaveReply } from '../lib/messaging'
import { requireSettings, toOrigin } from '../lib/storage'
import { capContentPayload } from '../lib/truncate'
import type { CaptureRequest } from '../lib/types'
import type { ContentCaptureResult } from '../content/content-main'
import { showFailureBadge, showSuccessBadge } from './badge'

const CONTEXT_MENU_ID = 'sieve-save-link'

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Save link to Sieve',
    contexts: ['link'],
  })
})

/**
 * Injects content-main.js into `tabId` and waits for its result message.
 *
 * Content scripts here are NEVER statically declared in the manifest (no
 * standing `content_scripts` entry, no `host_permissions`) — this call only
 * works at all because it runs inside the same user-gesture-driven
 * `activeTab` grant that triggered capture in the first place (a toolbar
 * click, this keyboard command, or — not used for this function, see
 * `handleContextMenuCapture` — a context-menu click). That grant is
 * per-invocation and temporary; nothing persists between captures.
 *
 * Uses message-passing rather than `executeScript`'s own return value: the
 * injected file is a real bundle (not a small inline function), and
 * message-passing is the more predictable, version-independent way to get a
 * result back out of it (see content-main.ts's file header).
 *
 * No request-id correlation: Sieve is single-user and this extension only
 * ever has one capture in flight at a time (each entry point disables
 * itself/awaits to completion before allowing another), so "the next
 * matching message is the one we're waiting for" is safe. If concurrent
 * captures across multiple tabs ever become a real use case, add a
 * generated id here and thread it through `content-main.ts`'s reply.
 */
async function injectAndCapture(tabId: number): Promise<ContentCaptureResult> {
  const resultPromise = new Promise<ContentCaptureResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener)
      reject(new Error('Timed out waiting for the page to respond. Reload the tab and try again.'))
    }, CONTENT_SCRIPT_TIMEOUT_MS)

    function listener(message: unknown): void {
      if (!isContentCaptureMessage(message)) return
      clearTimeout(timeout)
      chrome.runtime.onMessage.removeListener(listener)
      if (message.type === 'sieve:content-capture-error') {
        reject(new Error(message.error))
      } else {
        resolve(message.result)
      }
    }

    chrome.runtime.onMessage.addListener(listener)
  })

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content-main.js'],
  })

  return resultPromise
}

interface CaptureOutcome {
  id: string
  duplicate: boolean
  truncated: boolean
}

/** Shared save path for the toolbar/popup and keyboard-shortcut surfaces (both read the current tab's DOM). */
async function performTabCapture(tab: chrome.tabs.Tab, note?: string): Promise<CaptureOutcome> {
  if (!tab.id || !tab.url) {
    throw new Error('No active tab to capture.')
  }
  if (!/^https?:\/\//.test(tab.url)) {
    throw new Error('Sieve can only capture http(s) pages.')
  }

  const settings = await requireSettings()
  const origin = toOrigin(settings.serverUrl)
  const permission = await ensureServerOriginPermission(origin)
  if (!permission.granted) {
    throw new Error(permission.message)
  }

  const content = await injectAndCapture(tab.id)
  const capped = capContentPayload(content)

  const request: CaptureRequest = {
    url: tab.url,
    surface: 'extension',
    ...(content.title || tab.title ? { title: content.title || tab.title } : {}),
    ...(note ? { note } : {}),
    ...(capped.html ? { html: capped.html } : {}),
    ...(capped.transcript ? { transcript: capped.transcript } : {}),
    ...(capped.caption ? { caption: capped.caption } : {}),
  }

  const connection: SieveConnection = settings
  const response = await capture(connection, request)
  return { id: response.id, duplicate: response.duplicate, truncated: capped.truncated }
}

/**
 * Context-menu "Save link to Sieve": saves the anchor's *target* href, never
 * the page you right-clicked on, and never injects a script anywhere — the
 * link's URL and visible text are already handed to us in `info` by Chrome,
 * so there is nothing on the target page this needs to read.
 */
async function performLinkCapture(info: chrome.contextMenus.OnClickData): Promise<CaptureOutcome> {
  const linkUrl = info.linkUrl
  if (!linkUrl || !/^https?:\/\//.test(linkUrl)) {
    throw new Error('That link is not something Sieve can save.')
  }

  const settings = await requireSettings()
  const origin = toOrigin(settings.serverUrl)
  const permission = await ensureServerOriginPermission(origin)
  if (!permission.granted) {
    throw new Error(permission.message)
  }

  const request: CaptureRequest = {
    url: linkUrl,
    surface: 'extension',
    ...(info.linkText ? { title: info.linkText } : {}),
  }

  const connection: SieveConnection = settings
  const response = await capture(connection, request)
  return { id: response.id, duplicate: response.duplicate, truncated: false }
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'capture-page') return
  void (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab) throw new Error('No active tab to capture.')
      await performTabCapture(tab)
      await showSuccessBadge()
    } catch (err) {
      console.error('[Sieve] capture-page command failed:', describeError(err))
      await showFailureBadge()
    }
  })()
})

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return
  void (async () => {
    try {
      await performLinkCapture(info)
      await showSuccessBadge()
    } catch (err) {
      console.error('[Sieve] context-menu capture failed:', describeError(err))
      await showFailureBadge()
    }
  })()
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isPopupSaveMessage(message)) return undefined

  void (async () => {
    try {
      const tab = await chrome.tabs.get(message.tabId)
      const outcome = await performTabCapture(tab, message.note)
      await showSuccessBadge()
      const reply: PopupSaveReply = {
        ok: true,
        id: outcome.id,
        duplicate: outcome.duplicate,
        truncated: outcome.truncated,
      }
      sendResponse(reply)
    } catch (err) {
      await showFailureBadge()
      const reply: PopupSaveReply = { ok: false, message: describeError(err) }
      sendResponse(reply)
    }
  })()

  return true // keep the message channel open for the async sendResponse above
})

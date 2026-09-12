/**
 * Popup UI (P4.1.4): optional note + topic hint before saving. Talks to the
 * background service worker via a message rather than calling `/api/v1/capture`
 * directly, so there's exactly one place (service-worker.ts) that builds
 * requests, applies the payload cap, and sets the badge — the popup is a
 * thin UI over that, not a second implementation of the same logic.
 */

import type { PopupSaveReply } from '../lib/messaging'
import { getSettings } from '../lib/storage'

const pageTitleEl = document.getElementById('page-title') as HTMLParagraphElement
const formEl = document.getElementById('save-form') as HTMLFormElement
const topicHintEl = document.getElementById('topic-hint') as HTMLInputElement
const noteEl = document.getElementById('note') as HTMLTextAreaElement
const saveButtonEl = document.getElementById('save-button') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLParagraphElement
const optionsButtonEl = document.getElementById('open-options') as HTMLButtonElement

let activeTabId: number | undefined

function setStatus(kind: 'success' | 'error' | 'info', message: string): void {
  statusEl.hidden = false
  statusEl.textContent = message
  statusEl.className = `status status--${kind}`
}

/**
 * docs/API.md's `CaptureRequest` has one free-text `note` field and no
 * dedicated `topic_hint` field (see docs/API.md §4's own design-notes table)
 * — enrichment already reads `note` as context, so the hint travels the
 * same path, prefixed for readability rather than silently merged in.
 */
function combineNote(topicHint: string, note: string): string | undefined {
  const parts = [topicHint.trim() ? `Topic: ${topicHint.trim()}` : '', note.trim()].filter(Boolean)
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id && tab.url && /^https?:\/\//.test(tab.url)) {
    activeTabId = tab.id
    pageTitleEl.textContent = tab.title || tab.url
  } else {
    pageTitleEl.textContent = 'This page cannot be saved (not http/https).'
    saveButtonEl.disabled = true
  }

  const settings = await getSettings()
  if (!settings.serverUrl || !settings.token) {
    setStatus(
      'info',
      'Sieve is not configured yet — open Options to set your server URL and token.',
    )
    saveButtonEl.disabled = true
  }
}

formEl.addEventListener('submit', (event) => {
  event.preventDefault()
  if (activeTabId === undefined) return

  void (async () => {
    saveButtonEl.disabled = true
    setStatus('info', 'Saving…')

    try {
      const note = combineNote(topicHintEl.value, noteEl.value)
      const reply = (await chrome.runtime.sendMessage({
        type: 'sieve:popup-save',
        tabId: activeTabId,
        ...(note ? { note } : {}),
      })) as PopupSaveReply

      if (reply.ok) {
        const suffix = reply.truncated
          ? ' (content was truncated to fit the 1 MB capture limit)'
          : ''
        setStatus(
          'success',
          reply.duplicate ? `Already in Sieve — refreshed.${suffix}` : `Saved to Sieve.${suffix}`,
        )
      } else {
        setStatus('error', reply.message)
      }
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : 'Something went wrong. Try again.')
    } finally {
      saveButtonEl.disabled = false
    }
  })()
})

optionsButtonEl.addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
})

void init()

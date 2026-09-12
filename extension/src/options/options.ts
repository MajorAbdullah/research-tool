/**
 * Options page (P4.1.2): server URL + EXTENSION_TOKEN in `chrome.storage.sync`,
 * plus "Test connection" against `GET /api/v1/health`.
 */

import { checkHealth } from '../lib/api-client'
import { ensureServerOriginPermission, releaseServerOriginPermission } from '../lib/host-permission'
import { getSettings, saveSettings, toOrigin } from '../lib/storage'

const formEl = document.getElementById('settings-form') as HTMLFormElement
const serverUrlEl = document.getElementById('server-url') as HTMLInputElement
const tokenEl = document.getElementById('token') as HTMLInputElement
const toggleTokenEl = document.getElementById('toggle-token') as HTMLButtonElement
const saveButtonEl = document.getElementById('save-button') as HTMLButtonElement
const testButtonEl = document.getElementById('test-button') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLParagraphElement

function setStatus(kind: 'success' | 'error' | 'info', message: string): void {
  statusEl.hidden = false
  statusEl.textContent = message
  statusEl.className = `status status--${kind}`
}

function parseOrigin(
  rawUrl: string,
): { ok: true; origin: string } | { ok: false; message: string } {
  try {
    return { ok: true, origin: toOrigin(rawUrl) }
  } catch {
    return { ok: false, message: 'Enter a valid URL, e.g. https://sieve.teknikki.com' }
  }
}

toggleTokenEl.addEventListener('click', () => {
  const revealing = tokenEl.type === 'password'
  tokenEl.type = revealing ? 'text' : 'password'
  toggleTokenEl.textContent = revealing ? 'Hide' : 'Show'
})

formEl.addEventListener('submit', (event) => {
  event.preventDefault()
  void (async () => {
    saveButtonEl.disabled = true
    setStatus('info', 'Saving…')

    const parsed = parseOrigin(serverUrlEl.value)
    if (!parsed.ok) {
      setStatus('error', parsed.message)
      saveButtonEl.disabled = false
      return
    }

    const previous = await getSettings()
    const previousOrigin = previous.serverUrl ? toOrigin(previous.serverUrl) : undefined

    const permission = await ensureServerOriginPermission(parsed.origin)
    if (!permission.granted) {
      setStatus('error', permission.message)
      saveButtonEl.disabled = false
      return
    }

    await saveSettings({ serverUrl: serverUrlEl.value.trim(), token: tokenEl.value.trim() })

    if (previousOrigin && previousOrigin !== parsed.origin) {
      await releaseServerOriginPermission(previousOrigin)
    }

    setStatus('success', 'Saved.')
    saveButtonEl.disabled = false
  })()
})

testButtonEl.addEventListener('click', () => {
  void (async () => {
    testButtonEl.disabled = true
    setStatus('info', 'Testing connection…')

    const parsed = parseOrigin(serverUrlEl.value)
    if (!parsed.ok) {
      setStatus('error', parsed.message)
      testButtonEl.disabled = false
      return
    }

    const permission = await ensureServerOriginPermission(parsed.origin)
    if (!permission.granted) {
      setStatus('error', permission.message)
      testButtonEl.disabled = false
      return
    }

    const result = await checkHealth({
      serverUrl: serverUrlEl.value.trim(),
      token: tokenEl.value.trim(),
    })
    if (result.ok) {
      setStatus('success', 'Connected — server is healthy.')
    } else {
      setStatus('error', result.message)
    }
    testButtonEl.disabled = false
  })()
})

async function init(): Promise<void> {
  const settings = await getSettings()
  if (settings.serverUrl) serverUrlEl.value = settings.serverUrl
  if (settings.token) tokenEl.value = settings.token
}

void init()

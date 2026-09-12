/**
 * Server URL + EXTENSION_TOKEN, persisted in `chrome.storage.sync` (survives
 * restarts and rolls out to the user's other signed-in Chrome profiles) —
 * per the task brief and docs/API.md §1.2. Never hardcode a server URL
 * anywhere else in this codebase; it always comes from here.
 */

export interface SieveSettings {
  serverUrl: string
  token: string
}

const KEY_SERVER_URL = 'sieveServerUrl'
const KEY_TOKEN = 'sieveToken'

export async function getSettings(): Promise<Partial<SieveSettings>> {
  const stored = await chrome.storage.sync.get([KEY_SERVER_URL, KEY_TOKEN])
  const serverUrl = typeof stored[KEY_SERVER_URL] === 'string' ? stored[KEY_SERVER_URL] : undefined
  const token = typeof stored[KEY_TOKEN] === 'string' ? stored[KEY_TOKEN] : undefined
  return {
    ...(serverUrl ? { serverUrl } : {}),
    ...(token ? { token } : {}),
  }
}

export async function saveSettings(settings: SieveSettings): Promise<void> {
  await chrome.storage.sync.set({
    [KEY_SERVER_URL]: settings.serverUrl,
    [KEY_TOKEN]: settings.token,
  })
}

/** Throws a display-safe message (not a stack) when Sieve hasn't been configured yet. */
export async function requireSettings(): Promise<SieveSettings> {
  const settings = await getSettings()
  if (!settings.serverUrl || !settings.token) {
    throw new Error(
      'Sieve is not configured yet. Open the extension options and set your server URL and token.',
    )
  }
  return { serverUrl: settings.serverUrl, token: settings.token }
}

/** Normalizes a user-entered server URL into an origin string, e.g. "https://sieve.teknikki.com". */
export function toOrigin(serverUrl: string): string {
  return new URL(serverUrl).origin
}

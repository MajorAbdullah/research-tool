/**
 * Minimal service worker: just enough for Chrome's installability criteria (a registered SW with
 * a fetch handler) plus a small offline app-shell cache. Sieve's real data (items, search) always
 * needs a live network round-trip to the local SQLite-backed API — this deliberately does not try
 * to cache or serve API responses offline, only the static shell that lets the app open at all
 * without a network.
 *
 * Registered from `src/components/common/register-service-worker.tsx`, mounted in the ROOT
 * layout so every page counts toward installability — see that file for why it isn't scoped to
 * `/capture` any more.
 */

// Bump this whenever APP_SHELL changes. The activate handler deletes every cache whose key
// isn't the current one, so a bump is what evicts a stale precache — v1 held `/capture`, which
// is no longer the start_url.
const CACHE_NAME = 'sieve-shell-v2'

// Must stay in step with manifest.webmanifest's `start_url`: this is the page the installed
// icon opens, so it's the one that has to survive a cold start with no network.
const APP_SHELL = ['/library', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {
        // Best-effort precache — a single failed URL (e.g. offline during install, or /library
        // redirecting to /login because nobody is signed in yet) must not block the service
        // worker from installing at all, since installing is what makes the app installable.
      }),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  // Never intercept anything but a plain GET — critically, this must never touch the share
  // target's multipart POST or any API write, only ever read-through/cache navigation & assets.
  if (event.request.method !== 'GET') return

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone()
        caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(event.request, copy))
          .catch(() => {})
        return response
      })
      .catch(async () => {
        const cached = await caches.match(event.request)
        return cached ?? Response.error()
      }),
  )
})

/**
 * Minimal service worker: just enough for Chrome's installability criteria (a registered SW with
 * a fetch handler) plus a small offline app-shell cache. Sieve's real data (items, search) always
 * needs a live network round-trip to the local SQLite-backed API — this deliberately does not try
 * to cache or serve API responses offline, only the static shell that lets `/capture` open at all
 * without a network.
 *
 * Registered from `src/app/(capture)/register-service-worker.tsx`.
 */

const CACHE_NAME = 'sieve-shell-v1'
const APP_SHELL = ['/capture', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {
        // Best-effort precache — a single failed URL (e.g. offline during install) must not
        // block the service worker from installing at all.
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

'use client'

import { useEffect } from 'react'

/**
 * Fire-and-forget SW registration (P8.4) — renders nothing, just runs the side effect once.
 *
 * Mounted in the ROOT layout, so every page registers it. It started out scoped to `/capture`,
 * which meant Chrome only ever saw a service worker if you happened to navigate there first —
 * and since `/` redirects to `/library`, opening the app normally never offered "Install app"
 * at all. Installability has to be available from whatever page the user actually lands on.
 */
export function RegisterServiceWorker(): null {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Installability is a nice-to-have, not a page dependency — a failed registration
        // (unsupported browser, blocked storage, http://) must never affect the page itself.
      })
    }
  }, [])

  return null
}

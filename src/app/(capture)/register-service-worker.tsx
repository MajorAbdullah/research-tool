'use client'

import { useEffect } from 'react'

/** Fire-and-forget SW registration (P8.4) — renders nothing, just runs the side effect once. */
export function RegisterServiceWorker(): null {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Installability is a nice-to-have, not a capture-path dependency — a failed
        // registration (unsupported browser, blocked storage) must never affect the page itself.
      })
    }
  }, [])

  return null
}

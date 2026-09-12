/**
 * Layout for this phase's own pages (`/capture`, `/capture/confirm`) — nests inside the root
 * layout (`src/app/layout.tsx`, owned by another phase; not touched here). Two small additions
 * scoped to just these pages, not site-wide:
 *
 *  - `metadata.manifest` links `public/manifest.webmanifest`, so a visit to `/capture` is enough
 *    for Chrome to consider the app installable (P8.2). Next.js merges `<head>` metadata up the
 *    layout tree, so declaring it here rather than in the root layout is sufficient for exactly
 *    the pages this feature needs it on; site-wide linking is a one-line addition wherever a
 *    root/dashboard page eventually lands.
 *  - `<RegisterServiceWorker />` registers `public/sw.js` on mount (P8.4).
 */

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { RegisterServiceWorker } from './register-service-worker'

export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
}

export default function CaptureLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <RegisterServiceWorker />
      {children}
    </>
  )
}

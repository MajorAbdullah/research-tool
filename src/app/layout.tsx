import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import Script from 'next/script'

import '@/app/globals.css'
import { SidebarNav } from '@/components/common/sidebar-nav'
import { BottomNav } from '@/components/common/bottom-nav'
import { ThemeToggle } from '@/components/common/theme-toggle'
import { Toaster } from '@/components/ui/toaster'

export const metadata: Metadata = {
  title: 'Sieve',
  description: 'A self-hosted AI research library for people drowning in links.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The two hex values below are the sRGB-rendered equivalent of
  // globals.css's --background token in each mode (computed once, not
  // guessed) — a <meta name="theme-color"> tag can't reference a CSS
  // variable, so this is the one place a literal color value is
  // unavoidable. It only follows the OS media query, not a manual
  // [data-theme] override from ThemeToggle; keeping the browser chrome in
  // sync with a forced override would need client JS to rewrite this meta
  // tag, which isn't worth it for a chrome tint.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfcfd' },
    { media: '(prefers-color-scheme: dark)', color: '#0c1015' },
  ],
}

// Reads the persisted theme choice and stamps it on <html> before hydration,
// so a returning visitor who forced light/dark never sees a flash of the
// system default first. `strategy="beforeInteractive"` is next/script's
// documented mechanism for exactly this — it runs and blocks hydration, not
// merely "early" — and must live in the root layout. See ThemeToggle and
// globals.css's [data-theme] section for the rest of the mechanism.
const THEME_INIT_SCRIPT = `
try {
  var stored = window.localStorage.getItem('sieve-theme');
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.dataset.theme = stored;
  }
} catch (e) {}
`

/**
 * App shell: a sidebar on desktop, a bottom tab bar on mobile — see
 * SidebarNav/BottomNav for why each is its own small client component while
 * this file stays a server component. Both render from the same NAV_ITEMS
 * list so the two shells can't drift apart.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />

        <div className="flex min-h-screen flex-col md:flex-row">
          <div className="hidden md:flex">
            <SidebarNav />
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <span className="text-base font-semibold text-foreground md:hidden">Sieve</span>
              <span className="hidden md:block" aria-hidden="true" />
              <ThemeToggle />
            </header>

            <main className="min-w-0 flex-1 pb-20 md:pb-0">{children}</main>
          </div>

          <BottomNav />
        </div>

        <Toaster />
      </body>
    </html>
  )
}

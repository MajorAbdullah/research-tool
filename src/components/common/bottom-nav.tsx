'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'
import { NAV_ITEMS } from '@/components/common/nav-items'

/**
 * Mobile primary nav — persistent bottom bar rather than a hamburger drawer,
 * so the five destinations stay one thumb-tap away on the phone this app is
 * used on daily, instead of hidden behind a menu toggle. `min-h-touch`
 * (44px) plus `flex-1` gives each of the five items a tall, wide hit area
 * even on a narrow 390px screen; `env(safe-area-inset-bottom)` keeps it
 * clear of gesture-nav bars on modern Android devices.
 */
export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Primary"
      // `md:hidden` is load-bearing: this is a `fixed` element, so without it the mobile bar
      // renders on top of the desktop sidebar at every width. The layout already pairs it with
      // `main`'s `pb-20 md:pb-0`, which assumed this bar was gone at md+.
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname?.startsWith(`${item.href}/`)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-xs outline-none',
              // ring-inset (rather than the default outside ring) so the
              // focus ring isn't clipped by the viewport edge on the
              // outermost items.
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
              active ? 'font-semibold text-primary' : 'font-medium text-muted-foreground',
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

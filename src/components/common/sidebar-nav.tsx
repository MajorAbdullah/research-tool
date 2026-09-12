'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'
import { NAV_ITEMS } from '@/components/common/nav-items'

/**
 * Desktop primary nav. Client-only because "which link is active" depends on
 * the current path (`usePathname`) — everything else about the app shell
 * (layout.tsx itself) stays a server component; this is the one island that
 * genuinely needs it.
 */
export function SidebarNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Primary"
      className="flex w-56 shrink-0 flex-col gap-1 border-r border-border p-3"
    >
      <div className="px-2 py-3 text-lg font-semibold text-foreground">Sieve</div>
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname?.startsWith(`${item.href}/`)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-11 items-center gap-3 rounded-md px-3 text-sm outline-none',
              'focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-secondary font-semibold text-secondary-foreground'
                : 'font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground',
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

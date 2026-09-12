import { Download, Kanban, Library, MessageCircle, Settings, type LucideIcon } from 'lucide-react'

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
}

/**
 * Shared between SidebarNav (desktop) and BottomNav (mobile) so the two
 * shells can never drift out of sync — ui-ux-best-practices.md is explicit
 * that navigation placement/behavior should stay consistent across the
 * product, and a single source list is how that's enforced rather than
 * merely intended.
 *
 * Paths are this phase's best guess at the route each feature phase will
 * land on (P10 Library, P11 Board, P13 Chat, P12 Import, P1/P14 Settings) —
 * see the final report's "guessed" list. They 404 harmlessly until those
 * routes exist; update here once contracts.ts/the routing phases settle on
 * final paths.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Library', href: '/library', icon: Library },
  { label: 'Board', href: '/board', icon: Kanban },
  { label: 'Chat', href: '/chat', icon: MessageCircle },
  { label: 'Import', href: '/import', icon: Download },
  { label: 'Settings', href: '/settings', icon: Settings },
]

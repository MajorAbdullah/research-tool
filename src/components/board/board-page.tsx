'use client'

/**
 * Provider boundary for the board route. No `QueryClientProvider` exists anywhere in the app yet
 * (grep confirms it — the capture pages roll their own `useState`/`fetch` instead), even though
 * `@tanstack/react-query` is a pinned dependency and CLAUDE.md's Frontend section names it as
 * "the source of truth" for server data. Rather than modify `src/app/layout.tsx` (out of this
 * phase's scope) to mount one globally, the board mounts its own, scoped to just this route —
 * a `QueryClientProvider` is a perfectly ordinary React provider and doesn't have to live at the
 * app root. `useState(() => new QueryClient())` (not a module-level singleton) is the documented
 * App Router pattern: one instance per component mount, so nothing is shared across requests on
 * the server or across users.
 */

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { BoardView } from './board-view'

export function BoardPage() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <BoardView />
    </QueryClientProvider>
  )
}

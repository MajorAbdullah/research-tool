'use client'

import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Scoped TanStack Query provider for the `(library)` route group. `src/app/layout.tsx` (out of
 * this phase's scope) does not mount one at the app root, so each top-level client tree this
 * phase owns (library browse, item detail) mounts its own via `useState`'s lazy initializer —
 * one fresh `QueryClient` per page-tree mount, the pattern TanStack Query's own App Router docs
 * recommend, rather than a module-level singleton that would leak cached data across requests in
 * dev/server-rendering contexts.
 */
export function LibraryQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

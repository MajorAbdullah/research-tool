/**
 * `/items/:id` — item detail (plan §10.2). Server Component: fetches the full `Item` once
 * directly through the service layer (`getItemDetail`, the same function
 * `GET /api/v1/items/:id`'s route handler calls) so the page has real content on first paint,
 * then hands it to `ItemDetailView`, which owns every subsequent interaction (edits, retries)
 * through the actual versioned HTTP API.
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ItemDetailView } from '@/components/library/item-detail-view'
import { LibraryQueryProvider } from '@/components/library/query-provider'
import { requireSessionUserId } from '@/services/auth-context'
import { ApiError } from '@/services/http'
import { getItemDetail } from '@/services/items-service'

interface ItemDetailPageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: ItemDetailPageProps): Promise<Metadata> {
  const { id } = await params
  try {
    const userId = await requireSessionUserId()
    const item = getItemDetail(userId, id)
    return { title: `${item.title ?? 'Untitled'} · Sieve` }
  } catch {
    return { title: 'Sieve' }
  }
}

export default async function ItemDetailPage({ params }: ItemDetailPageProps) {
  const { id } = await params
  const userId = await requireSessionUserId()

  let item
  try {
    item = getItemDetail(userId, id)
  } catch (err) {
    // NOT_FOUND covers both "no such item" and "belongs to another user" (docs/API.md §1.5,
    // indistinguishable on purpose) — render the 404 route, not a generic error page. Anything
    // else is a genuine unexpected failure and belongs to this route's error.tsx boundary.
    if (err instanceof ApiError && err.code === 'NOT_FOUND') {
      notFound()
    }
    throw err
  }

  return (
    <LibraryQueryProvider>
      <ItemDetailView itemId={id} initialItem={item} />
    </LibraryQueryProvider>
  )
}

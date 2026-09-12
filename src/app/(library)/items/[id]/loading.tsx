import { ItemDetailSkeleton } from '@/components/library/item-detail-skeleton'

/** Next's automatic Suspense fallback while `page.tsx`'s server-side fetch is in flight. */
export default function ItemDetailLoading() {
  return <ItemDetailSkeleton />
}

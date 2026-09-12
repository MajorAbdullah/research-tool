import Link from 'next/link'
import { SearchX } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/common/empty-state'

/**
 * Rendered when `page.tsx` calls `notFound()` — no such item, or it belongs to another user
 * (docs/API.md §1.5: the two are indistinguishable on purpose, so this copy doesn't try to guess
 * which one happened).
 */
export default function ItemNotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <EmptyState
        icon={SearchX}
        title="Item not found"
        description="It may have been removed, or the link is wrong."
        action={
          <Link href="/library" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Back to library
          </Link>
        }
      />
    </div>
  )
}

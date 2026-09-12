import type { Metadata } from 'next'

import { BoardPage } from '@/components/board/board-page'

export const metadata: Metadata = {
  title: 'Board · Sieve',
  description: 'What you still owe yourself: Inbox, To Test, Testing, Tested, Archived/Dropped.',
}

export default function Page() {
  return <BoardPage />
}

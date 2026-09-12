import { Suspense } from 'react'
import { ConfirmClient } from './confirm-client'

// `useSearchParams` inside a client component needs a Suspense boundary (Next.js's documented
// requirement) so this segment doesn't force the whole route to client-only rendering.
export default function CaptureConfirmPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmClient />
    </Suspense>
  )
}

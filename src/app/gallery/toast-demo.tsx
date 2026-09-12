'use client'

import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'

/**
 * The one place in this gallery that has to be a client component: calling
 * `toast()` from an onClick means the element holding that handler must be
 * inside a 'use client' boundary. The rest of /gallery stays server-rendered
 * (see page.tsx) — this is intentionally the small, isolated exception.
 */
export function ToastDemoButtons() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        onClick={() =>
          toast({ title: 'Saved', description: 'The link was queued for extraction.' })
        }
      >
        Default
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast({
            variant: 'success',
            title: 'Marked as tested',
            description: 'Moved to the Tested column.',
          })
        }
      >
        Success
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast({
            variant: 'warning',
            title: 'Metadata only',
            description: 'Open with the extension to capture the full article.',
          })
        }
      >
        Warning
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast({
            variant: 'destructive',
            title: 'Extraction failed',
            description: 'GitHub API rate limit reached.',
          })
        }
      >
        Destructive
      </Button>
    </div>
  )
}

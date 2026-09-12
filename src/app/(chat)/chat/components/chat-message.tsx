import { SearchX } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { CitationChips } from './citation-chips'
import type { ChatMessageVM } from './use-chat-session'

export interface ChatMessageProps {
  message: ChatMessageVM
}

/** One bubble — user (right-aligned) or assistant (left-aligned), covering every per-message
 *  state this phase's states requirement lists: thinking (streaming, no text yet), streaming
 *  (partial text), grounded-done (text + citation chips), and "nothing-found" (grounded === false:
 *  a distinct, quieter treatment with no citation chips — see docs/API.md §3.8's `grounded` flag). */
export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const isThinking = !isUser && message.streaming && message.content.length === 0
  const isUngrounded = !isUser && !message.streaming && message.grounded === false

  return (
    <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed sm:max-w-[75%]',
          isUser && 'bg-primary text-primary-foreground',
          !isUser && !isUngrounded && 'border border-border bg-card text-card-foreground',
          !isUser &&
            isUngrounded &&
            'border border-dashed border-border bg-muted text-muted-foreground',
        )}
      >
        {isThinking ? (
          <div className="flex items-center gap-2" aria-live="polite">
            <span className="sr-only">Thinking…</span>
            <Skeleton className="h-3 w-32" />
          </div>
        ) : (
          <>
            {isUngrounded && (
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <SearchX className="size-3.5" aria-hidden="true" />
                Nothing found in your library
              </div>
            )}
            <p className="whitespace-pre-wrap">
              {message.content}
              {message.streaming && (
                <span
                  className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-current align-middle"
                  aria-hidden="true"
                />
              )}
            </p>
            {!message.streaming && message.grounded !== false && (
              <CitationChips sources={message.sources} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

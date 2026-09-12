'use client'

/**
 * `/chat` — ask-my-library chat (P13). Reuses P5's design system (`EmptyState`, `ErrorState`,
 * `Button`) rather than inventing new primitives, same brief every other phase in this project
 * follows. All chat/SSE logic lives in `./components/use-chat-session` — this page is the layout
 * and the state-to-UI mapping.
 *
 * Every required state lives somewhere on this page: empty (no messages yet, with suggested
 * questions), thinking/streaming (per-message, see ChatMessage), error (with retry), and
 * budget-exhausted (a dedicated banner — search and the rest of Sieve keep working at zero
 * budget, per CLAUDE.md, so this is deliberately a banner alongside the composer, not a page
 * takeover). "Nothing found" is per-message (`ChatMessage`'s `grounded === false` treatment).
 */

import { useEffect, useRef, useState } from 'react'
import { Clock, MessageCircle, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { ChatMessage } from './components/chat-message'
import { ChatComposer } from './components/chat-composer'
import { ScopeFilter } from './components/scope-filter'
import { useChatSession, type ChatScope } from './components/use-chat-session'

const SUGGESTIONS = [
  'What did I save about attention mechanisms?',
  'What repos do I have for LLM inference?',
  'What did I save about Kubernetes operators?',
]

const ONE_HOUR_MS = 60 * 60 * 1000

function formatResetIn(resetAt: number | null): string {
  if (!resetAt) return 'later today'
  const remainingMs = resetAt - Date.now()
  if (remainingMs <= 0) return 'shortly'
  const hours = Math.ceil(remainingMs / ONE_HOUR_MS)
  return hours <= 1 ? 'in under an hour' : `in about ${hours}h`
}

export default function ChatPage() {
  const { messages, status, errorMessage, budgetResetAt, sendMessage, retry } = useChatSession()
  const [scope, setScope] = useState<ChatScope>({})
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const busy = status === 'thinking' || status === 'streaming'

  return (
    <main className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-2xl flex-col gap-3 px-4 py-4 md:h-[calc(100dvh-3.5rem)]">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Ask your library</h1>
        <p className="text-sm text-muted-foreground">
          Answers come only from what you&rsquo;ve saved, with citations back to the source.
        </p>
      </div>

      <ScopeFilter scope={scope} onChange={setScope} disabled={busy} />

      <div className="flex-1 space-y-3 overflow-y-auto py-2">
        {messages.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title="Nothing asked yet"
            description="Ask about anything you've saved — Sieve answers only from your own library."
            action={
              <div className="flex w-full flex-col gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <Button
                    key={suggestion}
                    variant="outline"
                    size="sm"
                    className="justify-start whitespace-normal"
                    onClick={() => void sendMessage(suggestion, scope)}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            }
          />
        ) : (
          messages.map((message) => <ChatMessage key={message.id} message={message} />)
        )}
        <div ref={bottomRef} />
      </div>

      {status === 'error' && (
        <ErrorState
          title="That didn't go through"
          description={errorMessage ?? 'Something went wrong. Try again.'}
          action={
            <Button size="sm" onClick={retry}>
              <RotateCcw aria-hidden="true" /> Try again
            </Button>
          }
        />
      )}

      {status === 'budget_exhausted' && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-foreground"
        >
          <Clock className="size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            Today&rsquo;s free AI budget is spent — chat resumes {formatResetIn(budgetResetAt)}.
            Search and the rest of your library still work.
          </span>
        </div>
      )}

      <ChatComposer disabled={busy} onSend={(text) => void sendMessage(text, scope)} />
    </main>
  )
}

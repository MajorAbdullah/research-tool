'use client'

import { useState, type KeyboardEvent } from 'react'
import { Send } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

const MAX_MESSAGE_LENGTH = 4_000

export interface ChatComposerProps {
  disabled?: boolean
  onSend: (text: string) => void
}

/** The message input — Enter sends, Shift+Enter inserts a newline (standard chat convention).
 *  Disabled while a turn is in flight (`status` is 'thinking'/'streaming' upstream), so a user
 *  can't fire a second question that would race the first turn's SSE stream. */
export function ChatComposer({ disabled, onSend }: ChatComposerProps) {
  const [text, setText] = useState('')
  const trimmed = text.trim()
  const overLimit = text.length > MAX_MESSAGE_LENGTH

  function submit() {
    if (!trimmed || overLimit || disabled) return
    onSend(trimmed)
    setText('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about anything you've saved…"
          aria-label="Ask your library a question"
          rows={2}
          disabled={disabled}
          aria-invalid={overLimit}
          className="min-h-11 flex-1 resize-none"
        />
        <Button
          type="button"
          size="icon"
          disabled={disabled || !trimmed || overLimit}
          onClick={submit}
          aria-label="Send"
        >
          <Send aria-hidden="true" />
        </Button>
      </div>
      {overLimit && (
        <p className="text-xs text-destructive">
          {text.length.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()} characters — trim
          your question to send it.
        </p>
      )}
    </div>
  )
}

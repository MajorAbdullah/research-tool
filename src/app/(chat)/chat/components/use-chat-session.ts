'use client'

/**
 * Client-side SSE consumer for `POST /api/v1/chat` (docs/API.md §3.8). `EventSource` can't be used
 * here — it's GET-only and this endpoint is a `POST` with a JSON body — so this hand-parses the
 * `event:`/`data:` frame format directly off a `fetch()` response's `ReadableStream` body.
 *
 * Every UI state this phase is required to cover maps to a value here:
 *   - "empty"            -> `messages.length === 0` (page decides what to render)
 *   - "thinking"         -> `status === 'thinking'` (sources requested, no tokens yet)
 *   - "streaming"        -> `status === 'streaming'` (tokens arriving)
 *   - "error"            -> `status === 'error'`, `errorMessage` set
 *   - "budget-exhausted" -> `status === 'budget_exhausted'`, `budgetResetAt` set
 *   - "nothing-found"    -> per-message: `message.grounded === false` (docs/API.md's `grounded`
 *                           flag suppresses citation chips on that one turn, not the whole page)
 */

import { useCallback, useRef, useState } from 'react'
import type { ItemKind } from '@/types/contracts'

export interface ChatScope {
  kind?: ItemKind
  topic?: string
}

export interface ChatSourceVM {
  index: number
  item_id: string
  title: string | null
}

export interface ChatMessageVM {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources: ChatSourceVM[]
  /** `null` while streaming/thinking (not yet known); `true`/`false` once `done` arrives. */
  grounded: boolean | null
  streaming: boolean
}

export type ChatStatus = 'idle' | 'thinking' | 'streaming' | 'error' | 'budget_exhausted'

interface ApiErrorPayload {
  code: string
  message: string
  details: { resets_at?: number } | null
  request_id: string
}

interface ParsedSseEvent {
  event: string
  data: unknown
}

/** One `event: x\ndata: y` frame (already split on the blank-line terminator by the caller) ->
 *  its parsed event name + JSON payload, or `null` for a frame with no usable `data:` line. */
export function parseSseFrame(raw: string): ParsedSseEvent | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (dataLines.length === 0) return null
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) }
  } catch {
    return null
  }
}

let localIdCounter = 0
function nextLocalId(): string {
  localIdCounter += 1
  return `local-${localIdCounter}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function useChatSession() {
  const [messages, setMessages] = useState<ChatMessageVM[]>([])
  const [status, setStatus] = useState<ChatStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [budgetResetAt, setBudgetResetAt] = useState<number | null>(null)
  const conversationIdRef = useRef<string | undefined>(undefined)
  const lastMessageRef = useRef<{ text: string; scope: ChatScope } | null>(null)

  const updateAssistant = useCallback((id: string, patch: Partial<ChatMessageVM>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }, [])

  const removeMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id))
  }, [])

  const sendMessage = useCallback(
    async (text: string, scope: ChatScope) => {
      const trimmed = text.trim()
      if (!trimmed || status === 'thinking' || status === 'streaming') return
      lastMessageRef.current = { text: trimmed, scope }

      setErrorMessage(null)
      setBudgetResetAt(null)

      const userMessageId = nextLocalId()
      const assistantMessageId = nextLocalId()
      setMessages((prev) => [
        ...prev,
        {
          id: userMessageId,
          role: 'user',
          content: trimmed,
          sources: [],
          grounded: null,
          streaming: false,
        },
        {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          sources: [],
          grounded: null,
          streaming: true,
        },
      ])
      setStatus('thinking')

      try {
        const response = await fetch('/api/v1/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: trimmed,
            conversation_id: conversationIdRef.current,
            filters:
              scope.kind || scope.topic ? { kind: scope.kind, topic: scope.topic } : undefined,
          }),
        })

        if (!response.ok) {
          const body: unknown = await response.json().catch(() => null)
          const errorPayload =
            isRecord(body) && isRecord(body.error)
              ? (body.error as unknown as ApiErrorPayload)
              : null
          removeMessage(assistantMessageId)
          if (errorPayload?.code === 'LLM_BUDGET_EXHAUSTED') {
            setBudgetResetAt(errorPayload.details?.resets_at ?? null)
            setStatus('budget_exhausted')
          } else {
            setErrorMessage(errorPayload?.message ?? 'Something went wrong. Try again.')
            setStatus('error')
          }
          return
        }

        if (!response.body) throw new Error('No response body')
        setStatus('streaming')

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let sawError = false

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          let boundary = buffer.indexOf('\n\n')
          while (boundary !== -1) {
            const frame = parseSseFrame(buffer.slice(0, boundary))
            buffer = buffer.slice(boundary + 2)
            boundary = buffer.indexOf('\n\n')
            if (!frame) continue

            if (
              frame.event === 'sources' &&
              isRecord(frame.data) &&
              Array.isArray(frame.data.sources)
            ) {
              updateAssistant(assistantMessageId, { sources: frame.data.sources as ChatSourceVM[] })
            } else if (
              frame.event === 'token' &&
              isRecord(frame.data) &&
              typeof frame.data.text === 'string'
            ) {
              const text = frame.data.text
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId ? { ...m, content: m.content + text } : m,
                ),
              )
            } else if (frame.event === 'done' && isRecord(frame.data)) {
              if (typeof frame.data.conversation_id === 'string') {
                conversationIdRef.current = frame.data.conversation_id
              }
              updateAssistant(assistantMessageId, {
                grounded: typeof frame.data.grounded === 'boolean' ? frame.data.grounded : null,
                streaming: false,
              })
            } else if (frame.event === 'error' && isRecord(frame.data)) {
              sawError = true
              const errorPayload = isRecord(frame.data.error)
                ? (frame.data.error as unknown as ApiErrorPayload)
                : null
              removeMessage(assistantMessageId)
              if (errorPayload?.code === 'LLM_BUDGET_EXHAUSTED') {
                setBudgetResetAt(errorPayload.details?.resets_at ?? null)
                setStatus('budget_exhausted')
              } else {
                setErrorMessage(errorPayload?.message ?? 'Something went wrong. Try again.')
                setStatus('error')
              }
            }
          }
        }

        if (!sawError) setStatus('idle')
      } catch (err) {
        removeMessage(assistantMessageId)
        setErrorMessage(err instanceof Error ? err.message : 'Something went wrong. Try again.')
        setStatus('error')
      }
    },
    [status, updateAssistant, removeMessage],
  )

  const retry = useCallback(() => {
    const last = lastMessageRef.current
    if (last) void sendMessage(last.text, last.scope)
  }, [sendMessage])

  return { messages, status, errorMessage, budgetResetAt, sendMessage, retry }
}

/**
 * Low-level OpenRouter chat-completions transport. Deliberately dumb: it knows how to shape one
 * HTTP request and parse one response, nothing about chains, budgets, pacing, or schema
 * strategies — those are layered on top in `chain.ts`/`schema-strategies.ts`/`provider.ts` so this
 * file stays a thin, easily-mocked seam (tests inject `fetchImpl` and never touch the network).
 */

import { LlmTimeoutError, OpenRouterHttpError } from './errors'

export const CHAT_COMPLETIONS_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * A single-signature stand-in for the global `fetch`, used everywhere this codebase injects an
 * HTTP implementation. Deliberately not `typeof fetch`: the DOM/Node lib types declare `fetch` as
 * multiple overloads, and an overloaded type is something only a *real* `fetch` naturally
 * satisfies — a `vi.fn()` test double has one call signature and structurally fails assignability
 * against an overload set, even though it works perfectly at runtime. This is the abstraction
 * every call site actually depends on, both here and in tests.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
}

export interface OpenRouterToolFunctionDef {
  name: string
  description?: string
  parameters: Record<string, unknown>
}

export interface OpenRouterTool {
  type: 'function'
  function: OpenRouterToolFunctionDef
}

export type OpenRouterToolChoice = 'auto' | 'none' | { type: 'function'; function: { name: string } }

export interface OpenRouterResponseFormat {
  type: 'json_schema'
  json_schema: {
    name: string
    strict?: boolean
    schema: Record<string, unknown>
  }
}

export interface OpenRouterChatRequest {
  model: string
  messages: OpenRouterMessage[]
  max_tokens?: number
  response_format?: OpenRouterResponseFormat
  tools?: OpenRouterTool[]
  tool_choice?: OpenRouterToolChoice
  /**
   * Explicitly disabled for every structured/enrichment call (`schema-strategies.ts`) — verified
   * live: a reasoning-capable model (`nvidia/nemotron-3-super-120b-a12b:free`) with this omitted
   * emitted chain-of-thought prose into `message.content` instead of JSON, hit `max_tokens` before
   * finishing, and produced zero parseable output (`finish_reason: 'length'`). With `{enabled:
   * false}` it returned valid schema-conforming JSON in 66 completion tokens. Left `undefined`
   * (i.e. omitted) for the free-form chat/RAG path, where visible reasoning is fine.
   */
  reasoning?: { enabled: boolean }
}

export interface OpenRouterToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface OpenRouterChoice {
  index: number
  message: {
    role: string
    content: string | null
    tool_calls?: OpenRouterToolCall[]
    /** Non-null means the model declined to answer — a policy refusal, not malformed output.
     *  See `ModelRefusalError` in errors.ts: retrying the same prompt on the same model won't
     *  help, so callers must check this before attempting to parse `content`. */
    refusal?: string | null
    /** Visible chain-of-thought, present when `reasoning.enabled` wasn't forced off. Unused by
     *  the structured-output path (which forces it off); available for the chat/RAG path. */
    reasoning?: string | null
  }
  finish_reason?: string | null
}

export interface OpenRouterUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface OpenRouterChatResponse {
  id: string
  /** The RESOLVED model — may differ from `request.model` when a `:free` alias moves. */
  model: string
  choices: OpenRouterChoice[]
  usage?: OpenRouterUsage
}

export interface ChatCompletionCallOptions {
  apiKey: string
  timeoutMs: number
  /** Injection point for tests — the only thing standing between this module and the network. */
  fetchImpl?: FetchLike
}

export async function callChatCompletion(
  request: OpenRouterChatRequest,
  options: ChatCompletionCallOptions,
): Promise<OpenRouterChatResponse> {
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    let res: Response
    try {
      res = await fetchImpl(CHAT_COMPLETIONS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      })
    } catch (err) {
      if (controller.signal.aborted) {
        throw new LlmTimeoutError(request.model, options.timeoutMs)
      }
      throw err
    }
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '')
      throw new OpenRouterHttpError(res.status, request.model, bodyText)
    }
    return (await res.json()) as OpenRouterChatResponse
  } finally {
    clearTimeout(timer)
  }
}

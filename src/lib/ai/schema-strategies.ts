/**
 * The three schema-enforcement strategies (P3.1.3/3.1.4, ADR 0005): `response_format` (native
 * JSON schema), `tool_call` (forced single-function tool-call — how a model like
 * `nemotron-3-ultra` gets a guaranteed shape without JSON mode), and `prompt_repair` (no native
 * enforcement; describe the schema in the prompt, validate, and retry once with the validation
 * error fed back before failing loudly). `chain.ts` picks which one to use per model via the
 * capability probe; this file only knows how to execute a given strategy once.
 */

import { z } from 'zod'
import type { ZodType } from 'zod'
import type { LLMMessage, SchemaStrategy } from '@/types/contracts'
import {
  callChatCompletion,
  type ChatCompletionCallOptions,
  type FetchLike,
  type OpenRouterChatRequest,
  type OpenRouterChatResponse,
  type OpenRouterMessage,
} from './openrouter-client'
import { ModelRefusalError, SchemaValidationError } from './errors'

/**
 * The single forced tool every `structured()` call presents, regardless of which task called it
 * (enrichment today; possibly relation-labeling later). `LLMProvider.structured<T>()` is frozen
 * with no field for a per-call tool name, so rather than invent one outside the contract, the
 * tool-call strategy always names its one tool this — it is a pure, generic "save your schema-
 * shaped output here" carrier (P3.1.3/P3.2.1b: "a pure schema carrier ... no side-effecting tool
 * reachable from the enrichment call"), never a task-specific action, so a fixed name is correct,
 * not a shortcut.
 */
export const FORCED_TOOL_NAME = 'save_enrichment'

export interface StructuredCallParams<T> {
  model: string
  strategy: SchemaStrategy
  messages: LLMMessage[]
  schema: ZodType<T>
  maxTokens: number
  timeoutMs: number
  apiKey: string
  fetchImpl?: FetchLike
}

export interface StructuredCallResult<T> {
  data: T
  resolvedModel: string
  promptTokens: number
  completionTokens: number
}

function toOpenRouterMessages(messages: LLMMessage[]): OpenRouterMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }))
}

/** Some models wrap JSON in a ```json fence even when told not to; strip it before parsing. */
function stripMarkdownFences(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return fenced ? (fenced[1] ?? '') : trimmed
}

function buildStructuredRequest(
  model: string,
  strategy: SchemaStrategy,
  messages: OpenRouterMessage[],
  jsonSchema: Record<string, unknown>,
  maxTokens: number,
): OpenRouterChatRequest {
  const base: OpenRouterChatRequest = {
    model,
    messages,
    max_tokens: maxTokens,
    // Disabled for every structured strategy — see openrouter-client.ts's `reasoning` field doc.
    // A reasoning-capable model left to think out loud burns the completion budget on prose and
    // never emits parseable JSON at all.
    reasoning: { enabled: false },
  }
  switch (strategy) {
    case 'response_format':
      return {
        ...base,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'structured_output', strict: true, schema: jsonSchema },
        },
      }
    case 'tool_call':
      return {
        ...base,
        tools: [
          {
            type: 'function',
            function: {
              name: FORCED_TOOL_NAME,
              description:
                'Save the structured result. Pure data carrier: recording this call has no ' +
                'side effect of its own and triggers nothing else.',
              parameters: jsonSchema,
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: FORCED_TOOL_NAME } },
      }
    case 'prompt_repair':
      return {
        ...base,
        messages: [
          ...messages,
          {
            role: 'user',
            content:
              'Respond with ONLY a single JSON object matching this JSON Schema — no markdown ' +
              `fences, no commentary, no other text:\n${JSON.stringify(jsonSchema)}`,
          },
        ],
      }
  }
}

function extractRawPayload(strategy: SchemaStrategy, model: string, response: OpenRouterChatResponse): string {
  const choice = response.choices[0]
  if (!choice) {
    throw new Error(`OpenRouter response for '${model}' had no choices`)
  }
  if (choice.message.refusal) {
    throw new ModelRefusalError(model, choice.message.refusal)
  }
  if (strategy === 'tool_call') {
    const call = choice.message.tool_calls?.[0]
    if (!call) {
      throw new Error(`Expected a '${FORCED_TOOL_NAME}' tool call from '${model}' but got none`)
    }
    return call.function.arguments
  }
  const content = choice.message.content
  if (content === null || content === undefined || content === '') {
    throw new Error(`OpenRouter response for '${model}' had empty content`)
  }
  return stripMarkdownFences(content)
}

type ValidationOutcome<T> = { ok: true; data: T } | { ok: false; error: string }

function tryValidate<T>(schema: ZodType<T>, rawText: string): ValidationOutcome<T> {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(rawText)
  } catch (err) {
    return { ok: false, error: `Response was not valid JSON: ${(err as Error).message}` }
  }
  const result = schema.safeParse(parsedJson)
  if (result.success) return { ok: true, data: result.data }
  return { ok: false, error: z.prettifyError(result.error) }
}

function toResult<T>(data: T, response: OpenRouterChatResponse): StructuredCallResult<T> {
  return {
    data,
    resolvedModel: response.model,
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
  }
}

/**
 * Executes one strategy against one model, including the single corrective repair retry
 * (genai-best-practices: "feed validation errors back for one corrective retry, then fail
 * loudly"). A model *refusal* skips the repair retry entirely and propagates immediately — see
 * `ModelRefusalError`'s doc comment — since re-asking the same model the same question can't
 * un-refuse it; `chain.ts` catches whatever comes out of here and moves to the next model either
 * way.
 */
export async function callStructured<T>(
  params: StructuredCallParams<T>,
): Promise<StructuredCallResult<T>> {
  const jsonSchema = z.toJSONSchema(params.schema) as Record<string, unknown>
  const baseMessages = toOpenRouterMessages(params.messages)
  const callOptions: ChatCompletionCallOptions = {
    apiKey: params.apiKey,
    timeoutMs: params.timeoutMs,
    fetchImpl: params.fetchImpl,
  }

  const request = buildStructuredRequest(
    params.model,
    params.strategy,
    baseMessages,
    jsonSchema,
    params.maxTokens,
  )
  const first = await callChatCompletion(request, callOptions)
  const firstRaw = extractRawPayload(params.strategy, params.model, first)
  const firstOutcome = tryValidate(params.schema, firstRaw)
  if (firstOutcome.ok) {
    return toResult(firstOutcome.data, first)
  }

  // One corrective retry: replay the same strategy with the bad output + validation error
  // appended, asking for a fix.
  const repairRequest = buildStructuredRequest(
    params.model,
    params.strategy,
    [
      ...baseMessages,
      { role: 'assistant', content: firstRaw },
      {
        role: 'user',
        content:
          'That response was not valid: ' +
          firstOutcome.error +
          '\n\nReturn ONLY corrected JSON matching the required schema.',
      },
    ],
    jsonSchema,
    params.maxTokens,
  )
  const second = await callChatCompletion(repairRequest, callOptions)
  const secondRaw = extractRawPayload(params.strategy, params.model, second)
  const secondOutcome = tryValidate(params.schema, secondRaw)
  if (secondOutcome.ok) {
    return toResult(secondOutcome.data, second)
  }
  throw new SchemaValidationError(params.model, secondOutcome.error)
}

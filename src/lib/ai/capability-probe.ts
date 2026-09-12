/**
 * Capability probe (P3.1.2, ADR 0005): reads `supported_parameters` from OpenRouter's
 * `/api/v1/models` catalog at boot, caches it in memory, and derives a `SchemaStrategy` per model
 * — `response_format` if the model advertises `structured_outputs`, else `tool_call` if it
 * advertises `tools`, else `prompt_repair`. This is how a model substituted into either chain
 * later (free models rotate without warning) gets handled correctly with no code change.
 */

import type { SchemaStrategy } from '@/types/contracts'
import type { FetchLike } from './openrouter-client'

export interface ModelCapability {
  id: string
  /** OpenRouter's dated, stable alias for this slug, when it exposes one (P3.1.9 "pin the
   *  canonical_slug where available"). Absent for models that don't publish one. */
  canonicalSlug?: string
  contextLength: number
  supportedParameters: readonly string[]
  schemaStrategy: SchemaStrategy
}

/** A model missing from the last successful probe (newly rotated in, or the probe fetch itself
 *  failed at boot) gets the most conservative possible assumption — no schema enforcement to lean
 *  on, and a small context window so the long-content router stays cautious — rather than the
 *  caller crashing on a lookup miss. */
const UNKNOWN_MODEL_CONTEXT_LENGTH = 8_192

export function deriveSchemaStrategy(supportedParameters: readonly string[]): SchemaStrategy {
  if (supportedParameters.includes('structured_outputs')) return 'response_format'
  if (supportedParameters.includes('tools')) return 'tool_call'
  return 'prompt_repair'
}

interface OpenRouterModelEntry {
  id: string
  canonical_slug?: string
  context_length?: number
  supported_parameters?: string[]
}

interface OpenRouterModelsResponse {
  data?: OpenRouterModelEntry[]
}

export interface FetchModelCapabilitiesOptions {
  apiKey: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}

const MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models'

/** One HTTP call to the models catalog, turned into a lookup map keyed by model id. Called once
 *  at boot (and optionally re-run later to pick up a rotated model) — never per LLM call. */
export async function fetchModelCapabilities(
  options: FetchModelCapabilitiesOptions,
): Promise<Map<string, ModelCapability>> {
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000)
  try {
    const res = await fetchImpl(MODELS_ENDPOINT, {
      headers: { Authorization: `Bearer ${options.apiKey}` },
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new Error(`OpenRouter GET /api/v1/models returned ${res.status} ${res.statusText}`)
    }
    const body = (await res.json()) as OpenRouterModelsResponse
    const map = new Map<string, ModelCapability>()
    for (const entry of body.data ?? []) {
      const supportedParameters = entry.supported_parameters ?? []
      map.set(entry.id, {
        id: entry.id,
        canonicalSlug: entry.canonical_slug,
        contextLength: entry.context_length ?? UNKNOWN_MODEL_CONTEXT_LENGTH,
        supportedParameters,
        schemaStrategy: deriveSchemaStrategy(supportedParameters),
      })
    }
    return map
  } finally {
    clearTimeout(timer)
  }
}

/**
 * In-memory cache over the probe result. `getCapability()` never throws: a cache miss degrades to
 * the safest assumption rather than failing the caller (a model failure must degrade the item,
 * never crash the request — CLAUDE.md/P3.1.10).
 */
export class CapabilityProbe {
  private capabilities: Map<string, ModelCapability>

  constructor(initial: Map<string, ModelCapability> = new Map()) {
    this.capabilities = initial
  }

  /** Swap in a freshly-fetched snapshot (e.g. a manual re-probe after a model rotation). */
  replace(next: Map<string, ModelCapability>): void {
    this.capabilities = next
  }

  getCapability(modelId: string): ModelCapability {
    return (
      this.capabilities.get(modelId) ?? {
        id: modelId,
        contextLength: UNKNOWN_MODEL_CONTEXT_LENGTH,
        supportedParameters: [],
        schemaStrategy: 'prompt_repair',
      }
    )
  }

  /** The largest context window among a set of models — used by the long-content router to
   *  decide whether Chain A can hold the input at all before trying it. */
  maxContextLength(modelIds: readonly string[]): number {
    return modelIds.reduce((max, id) => Math.max(max, this.getCapability(id).contextLength), 0)
  }
}

/** Boot-time convenience: fetch once, wrap in a probe. What `instrumentation.ts` (P1) calls. */
export async function createCapabilityProbe(
  options: FetchModelCapabilitiesOptions,
): Promise<CapabilityProbe> {
  const capabilities = await fetchModelCapabilities(options)
  return new CapabilityProbe(capabilities)
}

import { describe, expect, it } from 'vitest'
import { routeForContentLength } from '@/lib/ai/long-content-router'
import { CapabilityProbe, type ModelCapability } from '@/lib/ai/capability-probe'
import type { LLMMessage } from '@/types/contracts'

function capabilityMap(
  entries: Array<Partial<ModelCapability> & { id: string; contextLength: number }>,
) {
  const map = new Map<string, ModelCapability>()
  for (const e of entries) {
    map.set(e.id, {
      id: e.id,
      contextLength: e.contextLength,
      supportedParameters: e.supportedParameters ?? [],
      schemaStrategy: e.schemaStrategy ?? 'prompt_repair',
    })
  }
  return map
}

const CHAIN_A = ['super-120b', 'dots-3-note']
const CHAIN_B = ['ultra-550b', 'inkling']

function probeWithChains(): CapabilityProbe {
  return new CapabilityProbe(
    capabilityMap([
      { id: 'super-120b', contextLength: 262_144 },
      { id: 'dots-3-note', contextLength: 512_000 },
      { id: 'ultra-550b', contextLength: 1_000_000 },
      { id: 'inkling', contextLength: 1_048_576 },
    ]),
  )
}

function messagesOfLength(chars: number): LLMMessage[] {
  return [{ role: 'user', content: 'x'.repeat(chars) }]
}

describe('routeForContentLength', () => {
  it('stays on the primary (enrichment) chain when the content fits', () => {
    const decision = routeForContentLength(
      messagesOfLength(1000), // ~250 estimated tokens
      CHAIN_A,
      CHAIN_B,
      probeWithChains(),
      3000,
    )
    expect(decision.routedToFallback).toBe(false)
    expect(decision.models).toBe(CHAIN_A)
  })

  it('routes to the chat chain when input overflows the primary chain’s largest window', () => {
    // Primary chain's largest window is 512,000 tokens (dots-3-note). Push well past that.
    const decision = routeForContentLength(
      messagesOfLength(600_000 * 4), // ~600,000 estimated tokens
      CHAIN_A,
      CHAIN_B,
      probeWithChains(),
      3000,
    )
    expect(decision.routedToFallback).toBe(true)
    expect(decision.models).toBe(CHAIN_B)
  })

  it('stays on the primary chain when there is no fallback configured, even if it overflows', () => {
    const decision = routeForContentLength(
      messagesOfLength(600_000 * 4),
      CHAIN_A,
      undefined,
      probeWithChains(),
      3000,
    )
    expect(decision.routedToFallback).toBe(false)
    expect(decision.models).toBe(CHAIN_A)
  })

  it('accounts for the completion reserve, not just the raw input size', () => {
    const probe = new CapabilityProbe(capabilityMap([{ id: 'small', contextLength: 1000 }]))
    // 900 tokens of input (3600 chars) + a 200-token completion reserve overflows a 1000-token
    // window even though the input alone would fit.
    const decision = routeForContentLength(messagesOfLength(3600), ['small'], CHAIN_B, probe, 200)
    expect(decision.routedToFallback).toBe(true)
  })
})

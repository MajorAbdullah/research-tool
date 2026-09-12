import { describe, expect, it, vi } from 'vitest'
import {
  CapabilityProbe,
  deriveSchemaStrategy,
  fetchModelCapabilities,
} from '@/lib/ai/capability-probe'
import openRouterModelsFixture from './fixtures/openrouter-models.json'

/** A `Response`-shaped fake, just enough for `fetchModelCapabilities` to consume. */
function fakeModelsResponse(): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => openRouterModelsFixture,
  } as unknown as Response
}

describe('deriveSchemaStrategy', () => {
  it('picks response_format when structured_outputs is advertised', () => {
    expect(deriveSchemaStrategy(['tools', 'structured_outputs', 'response_format'])).toBe(
      'response_format',
    )
  })

  it('picks tool_call when tools is advertised without structured_outputs', () => {
    expect(deriveSchemaStrategy(['tools', 'tool_choice'])).toBe('tool_call')
  })

  it('falls back to prompt_repair when neither is advertised', () => {
    expect(deriveSchemaStrategy(['max_tokens', 'temperature'])).toBe('prompt_repair')
  })
})

describe('fetchModelCapabilities + CapabilityProbe (against the recorded fixture)', () => {
  it('resolves nemotron-3-super-120b-a12b:free to response_format', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeModelsResponse())
    const capabilities = await fetchModelCapabilities({ apiKey: 'test-key', fetchImpl })
    const probe = new CapabilityProbe(capabilities)

    expect(probe.getCapability('nvidia/nemotron-3-super-120b-a12b:free').schemaStrategy).toBe(
      'response_format',
    )
  })

  it('resolves nemotron-3-ultra-550b-a55b:free to tool_call (supports tools, not response_format)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeModelsResponse())
    const capabilities = await fetchModelCapabilities({ apiKey: 'test-key', fetchImpl })
    const probe = new CapabilityProbe(capabilities)

    const ultra = probe.getCapability('nvidia/nemotron-3-ultra-550b-a55b:free')
    expect(ultra.schemaStrategy).toBe('tool_call')
    expect(ultra.supportedParameters).toContain('tools')
    expect(ultra.supportedParameters).not.toContain('response_format')
  })

  it('fetches the models endpoint exactly once with an auth header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeModelsResponse())
    await fetchModelCapabilities({ apiKey: 'secret-key', fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/models')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key')
  })

  it('degrades an unknown/rotated-in model to prompt_repair instead of throwing', async () => {
    const probe = new CapabilityProbe(new Map())
    const unknown = probe.getCapability('some/brand-new-model:free')
    expect(unknown.schemaStrategy).toBe('prompt_repair')
    expect(unknown.contextLength).toBeGreaterThan(0)
  })

  it('maxContextLength picks the largest window across a model list', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeModelsResponse())
    const capabilities = await fetchModelCapabilities({ apiKey: 'test-key', fetchImpl })
    const probe = new CapabilityProbe(capabilities)

    const max = probe.maxContextLength([
      'nvidia/nemotron-3-super-120b-a12b:free',
      'dots-studio/dots-3-note-preview:free',
    ])
    expect(max).toBe(512000)
  })

  it('surfaces a clear error on a non-200 response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    } as unknown as Response)

    await expect(fetchModelCapabilities({ apiKey: 'k', fetchImpl })).rejects.toThrow(/500/)
  })
})

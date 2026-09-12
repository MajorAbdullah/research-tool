import { describe, expect, it } from 'vitest'
import { loadPrompt } from '@/lib/ai/prompts'

describe('loadPrompt', () => {
  it('loads the real enrichment prompt file and parses its version from the filename', () => {
    const prompt = loadPrompt('enrichment.v1.md')
    expect(prompt.version).toBe('v1')
    expect(prompt.content.length).toBeGreaterThan(0)
    expect(prompt.content).toContain('untrusted_content')
  })

  it('loads the repo prompt extension', () => {
    const prompt = loadPrompt('enrichment-repo.v1.md')
    expect(prompt.version).toBe('v1')
    expect(prompt.content).toContain('what_it_does')
    expect(prompt.content).toContain('primary_use_case')
  })

  it('rejects an unversioned filename rather than silently loading it', () => {
    expect(() => loadPrompt('enrichment.md')).toThrow(/versioned/i)
  })

  it('throws a clear error for a prompt file that does not exist', () => {
    expect(() => loadPrompt('does-not-exist.v1.md')).toThrow()
  })
})

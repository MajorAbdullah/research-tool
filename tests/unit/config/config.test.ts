import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '@/lib/config'

/** A complete, valid env — every test starts from a copy of this and mutates just what it needs. */
const VALID_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  AUTH_SECRET: 'a'.repeat(32),
  SEED_USER_EMAIL: 'you@example.com',
  SEED_USER_PASSWORD: 'correct horse battery staple',
  EXTENSION_TOKEN: 'b'.repeat(32),
  OPENROUTER_API_KEY: 'sk-or-test-key',
  LLM_CHAIN_ENRICH: 'model-a:free,model-b:free',
  LLM_CHAIN_CHAT: 'model-c:free',
}

describe('loadConfig', () => {
  it('parses a fully-specified, valid env and applies documented defaults', () => {
    const config = loadConfig(VALID_ENV)

    expect(config.authSecret).toBe(VALID_ENV.AUTH_SECRET)
    expect(config.seedUserEmail).toBe('you@example.com')
    expect(config.extensionToken).toBe(VALID_ENV.EXTENSION_TOKEN)
    expect(config.openRouterApiKey).toBe('sk-or-test-key')
    expect(config.llmChainEnrich).toEqual(['model-a:free', 'model-b:free'])
    expect(config.llmChainChat).toEqual(['model-c:free'])

    // Defaults from .env.example, not required to be overridden.
    expect(config.appName).toBe('Sieve')
    expect(config.appUrl).toBe('http://localhost:3060')
    expect(config.port).toBe(3060)
    expect(config.sqlitePath).toBe('./data/sieve.db')
    expect(config.embeddingProvider).toBe('local')
    expect(config.llmDailyCap).toBe(900)
    expect(config.llmInteractiveReserve).toBe(100)
    expect(config.workerEnabled).toBe(true)
    expect(config.githubPat).toBeUndefined()
  })

  it('fails fast, naming the missing variable, when a required var is absent', () => {
    const { OPENROUTER_API_KEY: _drop, ...withoutOpenRouterKey } = VALID_ENV
    expect(() => loadConfig(withoutOpenRouterKey)).toThrow(ConfigError)
    expect(() => loadConfig(withoutOpenRouterKey)).toThrow(/OPENROUTER_API_KEY/)
  })

  it('fails fast, naming the missing variable, when a required var is present but blank', () => {
    // .env.example ships secrets as `KEY=` (present, empty) — this must fail exactly like a
    // fully-absent variable, not silently pass an empty string through.
    expect(() => loadConfig({ ...VALID_ENV, AUTH_SECRET: '' })).toThrow(/AUTH_SECRET/)
  })

  it('rejects a too-short AUTH_SECRET with a message pointing at how to generate a real one', () => {
    expect(() => loadConfig({ ...VALID_ENV, AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/)
  })

  it('rejects a malformed SEED_USER_EMAIL', () => {
    expect(() => loadConfig({ ...VALID_ENV, SEED_USER_EMAIL: 'not-an-email' })).toThrow(
      /SEED_USER_EMAIL/,
    )
  })

  it('reports every failing variable at once, not just the first', () => {
    try {
      loadConfig({ NODE_ENV: 'test' })
      expect.fail('loadConfig({ NODE_ENV: "test" }) should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      const message = (err as ConfigError).message
      expect(message).toMatch(/AUTH_SECRET/)
      expect(message).toMatch(/SEED_USER_EMAIL/)
      expect(message).toMatch(/EXTENSION_TOKEN/)
      expect(message).toMatch(/OPENROUTER_API_KEY/)
    }
  })

  it('parses WORKER_ENABLED=false into a real boolean', () => {
    expect(loadConfig({ ...VALID_ENV, WORKER_ENABLED: 'false' }).workerEnabled).toBe(false)
    expect(loadConfig({ ...VALID_ENV, WORKER_ENABLED: 'true' }).workerEnabled).toBe(true)
    expect(loadConfig({ ...VALID_ENV, WORKER_ENABLED: 'FALSE' }).workerEnabled).toBe(false)
  })

  it('splits comma-separated model chains, trimming whitespace and dropping empty entries', () => {
    const config = loadConfig({ ...VALID_ENV, LLM_CHAIN_ENRICH: ' model-a:free ,  , model-b:free' })
    expect(config.llmChainEnrich).toEqual(['model-a:free', 'model-b:free'])
  })

  it('rejects LLM_INTERACTIVE_RESERVE greater than LLM_DAILY_CAP', () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, LLM_DAILY_CAP: '100', LLM_INTERACTIVE_RESERVE: '200' }),
    ).toThrow(/LLM_INTERACTIVE_RESERVE/)
  })

  it('accepts an optional GITHUB_PAT when provided', () => {
    expect(loadConfig({ ...VALID_ENV, GITHUB_PAT: 'ghp_test' }).githubPat).toBe('ghp_test')
  })

  it('treats a blank GITHUB_PAT the same as an absent one, not a validation error', () => {
    // Regression test: .env.example ships GITHUB_PAT=<blank> for "not configured", and this
    // must parse cleanly (undefined), not throw the way a blank *required* secret does above.
    expect(loadConfig({ ...VALID_ENV, GITHUB_PAT: '' }).githubPat).toBeUndefined()
  })
})

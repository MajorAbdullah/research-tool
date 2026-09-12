import { describe, it, expect } from 'vitest'

/**
 * Guard test. next-auth@5.0.0-beta.32 imports `next/server` without a file extension,
 * which Vite's resolver rejects — so before the `next/server` alias in vitest.config.mts,
 * every test that transitively imported src/lib/auth.ts failed to load and auth was
 * effectively untestable. This fails loudly if that alias is ever removed.
 */
describe('auth module is importable under vitest', () => {
  it('loads src/lib/auth.ts and its next-auth dependency chain', async () => {
    const mod = await import('@/lib/auth')
    expect(mod).toBeTruthy()
  })
})

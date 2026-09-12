import { describe, expect, it, vi } from 'vitest'
import { ExtractionTier } from '@/types/contracts'
import { runLadder } from '@/lib/extractors/ladder'
import type { Rung } from '@/lib/extractors/ladder'

function fakeLogger() {
  const warn = vi.fn((_message: string, _meta?: Record<string, unknown>) => {})
  return { warn }
}

describe('runLadder', () => {
  it('returns the first rung immediately and never calls later rungs', async () => {
    const rung2 = vi.fn()
    const rungs: Rung[] = [
      {
        tier: ExtractionTier.Full,
        name: 'rung-1',
        run: async () => ({ contentText: 'from rung 1' }),
      },
      { tier: ExtractionTier.Partial, name: 'rung-2', run: rung2 },
    ]

    const result = await runLadder(rungs)

    expect(result).toEqual({ contentText: 'from rung 1', extractionTier: ExtractionTier.Full })
    expect(rung2).not.toHaveBeenCalled()
  })

  it('falls through to rung 2 when rung 1 throws, and logs the failure without throwing', async () => {
    const logger = fakeLogger()
    const rungs: Rung[] = [
      {
        tier: ExtractionTier.Full,
        name: 'client-capture',
        run: async () => {
          throw new Error('boom')
        },
      },
      {
        tier: ExtractionTier.Partial,
        name: 'server-fallback',
        run: async () => ({ contentText: 'from rung 2' }),
      },
    ]

    const result = await runLadder(rungs, logger)

    expect(result).toEqual({ contentText: 'from rung 2', extractionTier: ExtractionTier.Partial })
    expect(logger.warn).toHaveBeenCalledTimes(1)
    const [message, meta] = logger.warn.mock.calls[0] as [string, Record<string, unknown>]
    expect(message).toContain('client-capture')
    expect(meta['error']).toContain('boom')
  })

  it('falls through to rung 2 when rung 1 returns null (not just when it throws)', async () => {
    const logger = fakeLogger()
    const rungs: Rung[] = [
      { tier: ExtractionTier.Full, name: 'client-capture', run: async () => null },
      {
        tier: ExtractionTier.MetadataOnly,
        name: 'url-only',
        run: async () => ({ contentText: 'fallback' }),
      },
    ]

    const result = await runLadder(rungs, logger)

    expect(result).toEqual({ contentText: 'fallback', extractionTier: ExtractionTier.MetadataOnly })
    // A null return is not a thrown error, but it's still "this rung didn't work" and gets logged.
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('throws its own error when every rung fails, instead of returning something fabricated', async () => {
    const rungs: Rung[] = [
      { tier: ExtractionTier.Full, name: 'rung-1', run: async () => null },
      {
        tier: ExtractionTier.Partial,
        name: 'rung-2',
        run: async () => {
          throw new Error('also broken')
        },
      },
    ]

    await expect(runLadder(rungs, fakeLogger())).rejects.toThrow(/every rung failed/i)
  })
})

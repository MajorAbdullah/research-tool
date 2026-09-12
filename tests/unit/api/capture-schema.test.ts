import { describe, expect, it } from 'vitest'
import { CaptureRequestSchema } from '@/services/capture-schema'

describe('CaptureRequestSchema', () => {
  it('accepts the minimal required shape', () => {
    const result = CaptureRequestSchema.safeParse({ url: 'https://example.com', surface: 'web' })
    expect(result.success).toBe(true)
  })

  it('accepts every optional field the extension can send', () => {
    const result = CaptureRequestSchema.safeParse({
      url: 'https://example.com',
      surface: 'extension',
      title: 't',
      note: 'n',
      html: '<html></html>',
      transcript: 'transcript text',
      caption: 'a caption',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a missing url', () => {
    expect(CaptureRequestSchema.safeParse({ surface: 'web' }).success).toBe(false)
  })

  it('rejects a non-http(s) url', () => {
    expect(
      CaptureRequestSchema.safeParse({ url: 'ftp://example.com', surface: 'web' }).success,
    ).toBe(false)
    expect(CaptureRequestSchema.safeParse({ url: 'not a url', surface: 'web' }).success).toBe(false)
  })

  it('rejects a missing or unknown surface', () => {
    expect(CaptureRequestSchema.safeParse({ url: 'https://example.com' }).success).toBe(false)
    expect(
      CaptureRequestSchema.safeParse({ url: 'https://example.com', surface: 'carrier-pigeon' })
        .success,
    ).toBe(false)
  })

  it('accepts every documented SourceSurface value', () => {
    for (const surface of ['extension', 'pwa', 'web', 'import']) {
      expect(CaptureRequestSchema.safeParse({ url: 'https://example.com', surface }).success).toBe(
        true,
      )
    }
  })
})

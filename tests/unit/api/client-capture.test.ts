import { describe, expect, it } from 'vitest'
import {
  hasAnyHint,
  mergeClientCaptureIntoRawPayload,
  pickHint,
  readStoredClientCapture,
} from '@/services/client-capture'

describe('pickHint / hasAnyHint', () => {
  it('picks only the defined, non-empty fields', () => {
    expect(pickHint({ html: '<a>', transcript: '', caption: undefined })).toEqual({ html: '<a>' })
  })

  it('hasAnyHint is false for an all-empty hint', () => {
    expect(hasAnyHint({})).toBe(false)
    expect(hasAnyHint({ html: '' })).toBe(false)
  })

  it('hasAnyHint is true when any field is present', () => {
    expect(hasAnyHint({ caption: 'x' })).toBe(true)
  })
})

describe('readStoredClientCapture', () => {
  it('reads back a previously-stored clientCapture bag', () => {
    const stored = readStoredClientCapture({ clientCapture: { transcript: 't' }, somethingElse: 1 })
    expect(stored).toEqual({ transcript: 't' })
  })

  it('returns {} for null/non-object/absent raw_payload', () => {
    expect(readStoredClientCapture(null)).toEqual({})
    expect(readStoredClientCapture(undefined)).toEqual({})
    expect(readStoredClientCapture('a string')).toEqual({})
    expect(readStoredClientCapture({})).toEqual({})
  })
})

describe('mergeClientCaptureIntoRawPayload', () => {
  it('merges a fresh hint over stored content field-by-field — fresh wins per field, others untouched', () => {
    const existing = { clientCapture: { transcript: 'old transcript', html: 'old html' } }
    const merged = mergeClientCaptureIntoRawPayload(existing, { transcript: 'new transcript' })
    expect(merged.clientCapture).toEqual({ transcript: 'new transcript', html: 'old html' })
  })

  it('preserves other keys already on raw_payload untouched', () => {
    const existing = { extractorRaw: { some: 'thing' }, clientCapture: { caption: 'c' } }
    const merged = mergeClientCaptureIntoRawPayload(existing, { transcript: 't' })
    expect(merged.extractorRaw).toEqual({ some: 'thing' })
    expect(merged.clientCapture).toEqual({ caption: 'c', transcript: 't' })
  })

  it('starts fresh when there was no prior raw_payload at all', () => {
    const merged = mergeClientCaptureIntoRawPayload(null, { caption: 'c' })
    expect(merged).toEqual({ clientCapture: { caption: 'c' } })
  })
})

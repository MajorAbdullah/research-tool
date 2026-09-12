import { describe, expect, it } from 'vitest'
import { capContentPayload } from '../../src/lib/truncate'

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

describe('capContentPayload', () => {
  it('leaves content untouched when already under the cap', () => {
    const result = capContentPayload({ html: '<p>hello</p>', transcript: '[0:00] hi' }, 1_000)
    expect(result.truncated).toBe(false)
    expect(result.html).toBe('<p>hello</p>')
    expect(result.transcript).toBe('[0:00] hi')
  })

  it('never touches fields that were not provided', () => {
    const result = capContentPayload({ transcript: 'x'.repeat(5_000) }, 1_000)
    expect(result.html).toBeUndefined()
    expect(result.caption).toBeUndefined()
  })

  it('truncates a single oversized field and marks the result as truncated', () => {
    const original = 'a'.repeat(5_000)
    const result = capContentPayload({ transcript: original }, 1_000)

    expect(result.truncated).toBe(true)
    expect(result.transcript).toBeDefined()
    expect(byteLength(result.transcript as string)).toBeLessThanOrEqual(1_000)
    // Content shrank — never dropped to undefined/empty, and it should still
    // start with the original text (head is kept, marker appended at the tail).
    expect(result.transcript?.startsWith('aaaa')).toBe(true)
    expect(result.transcript).toContain('truncated')
  })

  it('shrinks multiple oversized fields proportionally to their size', () => {
    const html = 'h'.repeat(8_000) // 80% of the pre-cap total
    const transcript = 't'.repeat(2_000) // 20% of the pre-cap total
    const result = capContentPayload({ html, transcript }, 1_000)

    expect(result.truncated).toBe(true)
    const htmlLen = byteLength(result.html as string)
    const transcriptLen = byteLength(result.transcript as string)
    expect(htmlLen).toBeLessThanOrEqual(1_000)
    expect(transcriptLen).toBeLessThanOrEqual(1_000)
    // The larger original field should still end up with the larger share.
    expect(htmlLen).toBeGreaterThan(transcriptLen)
  })

  it('never drops the request even when the budget is smaller than the marker itself', () => {
    expect(() => capContentPayload({ caption: 'x'.repeat(500) }, 10)).not.toThrow()
    const result = capContentPayload({ caption: 'x'.repeat(500) }, 10)
    expect(result.truncated).toBe(true)
    expect(result.caption).toBeDefined()
  })

  it('never splits a surrogate pair at the cut boundary, across a range of caps', () => {
    // Each 😀 is one UTF-16 surrogate pair / 4 UTF-8 bytes long. `TextEncoder`
    // does not throw on a lone surrogate — it silently substitutes U+FFFD,
    // which historically let a byte-length-only cut land mid-pair without
    // ever being detected as "too long" (see the regression this guards in
    // src/lib/truncate.ts's `truncateToBytes`). Sweep a range of caps rather
    // than one hand-picked number, since the bug only shows up for specific
    // boundary values relative to the marker's own byte length.
    const original = '😀'.repeat(500)
    for (let cap = 80; cap <= 140; cap += 1) {
      const result = capContentPayload({ caption: original }, cap)
      const kept = (result.caption as string).replace(/\n\n\[.*$/s, '')
      expect(kept).not.toContain('�')
      expect([...kept].every((ch) => ch === '😀')).toBe(true)
    }
  })

  it('applies the real 1 MB default cap when none is given', () => {
    const result = capContentPayload({ html: 'z'.repeat(2_000_000) })
    expect(result.truncated).toBe(true)
    expect(byteLength(result.html as string)).toBeLessThanOrEqual(1_000_000)
  })
})

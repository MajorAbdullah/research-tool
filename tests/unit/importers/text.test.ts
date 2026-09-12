import { describe, expect, it } from 'vitest'
import { normalizeLine, splitLines } from '../../../src/lib/importers/text'

describe('normalizeLine', () => {
  it('strips LRM (U+200E) and RLM (U+200F) marks', () => {
    const lrm = String.fromCodePoint(0x200e)
    const rlm = String.fromCodePoint(0x200f)
    expect(normalizeLine(`[${lrm}12/09/2026] ${rlm}Name: hi`)).toBe('[12/09/2026] Name: hi')
  })

  it('strips a leading byte-order mark', () => {
    const bom = String.fromCodePoint(0xfeff)
    expect(normalizeLine(`${bom}hello`)).toBe('hello')
  })

  it('strips zero-width space/joiner/non-joiner and bidi embedding/isolate controls', () => {
    const zwsp = String.fromCodePoint(0x200b)
    const zwnj = String.fromCodePoint(0x200c)
    const zwj = String.fromCodePoint(0x200d)
    const rle = String.fromCodePoint(0x202b) // bidi embedding control
    const lri = String.fromCodePoint(0x2066) // bidi isolate control
    expect(normalizeLine(`a${zwsp}b${zwnj}c${zwj}d${rle}e${lri}f`)).toBe('abcdef')
  })

  it('normalizes NBSP and narrow-NBSP to a plain space', () => {
    const nbsp = String.fromCodePoint(0x00a0)
    const nnbsp = String.fromCodePoint(0x202f)
    expect(normalizeLine(`4:35${nnbsp}PM${nbsp}today`)).toBe('4:35 PM today')
  })

  it('leaves an already-clean line untouched', () => {
    const line = '[12/09/2026, 4:35:12 PM] Name: https://example.com'
    expect(normalizeLine(line)).toBe(line)
  })
})

describe('splitLines', () => {
  it('splits on \\n, \\r\\n and \\r uniformly', () => {
    expect(splitLines('a\nb\r\nc\rd')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('preserves empty lines as empty strings', () => {
    expect(splitLines('a\n\nb')).toEqual(['a', '', 'b'])
  })
})

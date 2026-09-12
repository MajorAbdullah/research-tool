import { describe, expect, it } from 'vitest'
import { resolveSharePayload } from '@/services/share'

describe('resolveSharePayload', () => {
  it('uses the url field directly when it is already a valid http(s) URL', () => {
    const result = resolveSharePayload('https://example.com/a', 'a caption')
    expect(result).toEqual({ url: 'https://example.com/a', note: 'a caption' })
  })

  it('the Android/Instagram quirk: finds the URL inside `text` when `url` is empty', () => {
    const result = resolveSharePayload(
      '',
      'Check this out: https://www.instagram.com/reel/Cxyz123/ so cool',
    )
    expect(result).toEqual({
      url: 'https://www.instagram.com/reel/Cxyz123/',
      note: 'Check this out: so cool',
    })
  })

  it('strips trailing sentence punctuation from a URL found in text', () => {
    const result = resolveSharePayload('', 'Look at this. https://example.com/foo. Neat right?')
    expect(result?.url).toBe('https://example.com/foo')
    expect(result?.note).toBe('Look at this. Neat right?')
  })

  it('has no note when the whole text field is just the URL', () => {
    const result = resolveSharePayload('', 'https://example.com/only-a-link')
    expect(result).toEqual({ url: 'https://example.com/only-a-link', note: undefined })
  })

  it('falls back to hunting inside the url field itself as a last resort', () => {
    const result = resolveSharePayload('via https://example.com/buried', '')
    expect(result?.url).toBe('https://example.com/buried')
  })

  it('returns null when no URL can be found anywhere', () => {
    expect(resolveSharePayload('', 'no link in here at all')).toBeNull()
    expect(resolveSharePayload('', '')).toBeNull()
  })
})

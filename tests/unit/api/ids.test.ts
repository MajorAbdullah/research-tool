import { describe, expect, it } from 'vitest'
import { fromItemId, toItemId } from '@/services/ids'

describe('toItemId / fromItemId', () => {
  it('round-trips a row id through the opaque wire id', () => {
    expect(toItemId(42)).toBe('itm_42')
    expect(fromItemId('itm_42')).toBe(42)
  })

  it('rejects anything that is not a well-formed itm_<positive-integer> id', () => {
    expect(fromItemId('itm_0')).toBeNull()
    expect(fromItemId('itm_-1')).toBeNull()
    expect(fromItemId('itm_abc')).toBeNull()
    expect(fromItemId('itm_')).toBeNull()
    expect(fromItemId('imp_42')).toBeNull()
    expect(fromItemId('42')).toBeNull()
    expect(fromItemId('itm_007')).toBeNull() // no leading zeros — not how toItemId ever formats one
  })
})

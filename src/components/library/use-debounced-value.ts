'use client'

import { useEffect, useState } from 'react'

/**
 * Returns `value`, updated only after it stops changing for `delayMs`. Deliberately generic
 * (not string-specific) — today it debounces the search box's text (deliverable #2: "debounced
 * 250 ms"), and any future rapid client input can reuse it without a second hook.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(handle)
  }, [value, delayMs])

  return debounced
}

'use client'

import { useEffect, useRef } from 'react'

/**
 * A bottom-of-grid sentinel `<div>` ref: fires `onIntersect` once the sentinel scrolls near the
 * viewport (`rootMargin` pre-fetches before the user hits the literal bottom, so "1k items scroll
 * smoothly" — plan §10.1.1 — never shows a dead-stop pause). Disabled entirely (no observer at
 * all) once there's nothing more to fetch or a fetch is already in flight, so it can never queue
 * duplicate page requests.
 */
export function useInfiniteScrollSentinel(onIntersect: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null)
  const onIntersectRef = useRef(onIntersect)

  // Keep the ref fresh from an effect, never during render (writing a ref during render is
  // disallowed — react-hooks/refs) — this runs after every commit, so the IntersectionObserver
  // callback below always reads the latest closure without needing to recreate the observer
  // itself every time `onIntersect` changes identity.
  useEffect(() => {
    onIntersectRef.current = onIntersect
  })

  useEffect(() => {
    if (!enabled) return
    const node = ref.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onIntersectRef.current()
      },
      { rootMargin: '600px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled])

  return ref
}

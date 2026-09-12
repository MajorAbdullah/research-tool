'use client'

import { useEffect, useRef, type RefObject } from 'react'

/**
 * Wires a native `<dialog>` element's imperative `showModal()`/`close()` to a
 * React `open` boolean, and reports the dialog's own native close (Escape
 * key, or a future `<form method="dialog">` submit) back through
 * `onOpenChange`. Shared by Dialog and Sheet — both render a native
 * `<dialog>` and differ only in how its contents are positioned/animated,
 * which is exactly the kind of native-element choice this phase prefers
 * over hand-rolling a focus trap: `showModal()` gives us top-layer
 * rendering, a real focus trap, Escape-to-close, and focus restoration on
 * close for free.
 */
export function useDialogElement(
  open: boolean,
  onOpenChange: (open: boolean) => void
): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) node.showModal()
    else if (!open && node.open) node.close()
  }, [open])

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const handleClose = () => onOpenChange(false)
    node.addEventListener('close', handleClose)
    return () => node.removeEventListener('close', handleClose)
  }, [onOpenChange])

  useEffect(() => {
    const node = ref.current
    if (!node) return
    // A click that lands on the <dialog> element itself (rather than inside
    // the content box nested within it) is a click on the ::backdrop — the
    // standard way to detect "click outside to close" for this element.
    const handleClick = (event: MouseEvent) => {
      if (event.target === node) onOpenChange(false)
    }
    node.addEventListener('click', handleClick)
    return () => node.removeEventListener('click', handleClick)
  }, [onOpenChange])

  return ref
}

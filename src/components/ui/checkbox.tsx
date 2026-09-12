import { forwardRef, type InputHTMLAttributes } from 'react'
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'>

/**
 * Native `<input type="checkbox">` — Radix-free because a native element
 * genuinely suffices here (keyboard, forms, and screen readers all handle it
 * for free). Visually it's a compact ~20px box, but the invisible input
 * underneath fills the whole 44x44 wrapper, so the *tappable* area still
 * meets the touch-target requirement without the glyph looking oversized in
 * a dense list. Pair with `<Label htmlFor>` for the accessible name — this
 * component doesn't inject one itself.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, ...props },
  ref,
) {
  return (
    // Both the visual box and the checkmark must be direct siblings of the
    // <input> (not nested inside each other) — Tailwind's `peer-*` variant
    // compiles to a CSS general-sibling (~) selector, which only reaches
    // same-level siblings, not descendants of a sibling. All three are
    // centered independently via `inset-0 m-auto` since `absolute` pulls
    // them out of the parent's flex flow.
    <span className="relative inline-flex size-touch shrink-0">
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          'peer absolute inset-0 size-full cursor-pointer appearance-none rounded-md',
          'disabled:cursor-not-allowed',
          className,
        )}
        {...props}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 m-auto size-5 rounded-[0.3rem] border border-input bg-transparent',
          'peer-checked:border-primary peer-checked:bg-primary',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
          'peer-disabled:opacity-50',
        )}
      />
      <Check
        aria-hidden="true"
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto size-3.5 text-primary-foreground opacity-0 peer-checked:opacity-100"
      />
    </span>
  )
})

import type { LabelHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

/**
 * A styled, semantic `<label>`. Not in the phase brief's literal primitive
 * list, but added deliberately: "labeled inputs" is a hard requirement, and
 * Input/Textarea/Select/Checkbox all need something to pair with via
 * `htmlFor`/`id`. Consumers wire the association explicitly (see the
 * gallery) — this component doesn't generate ids itself, so it stays a
 * zero-JS server component.
 */
export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        'text-sm leading-none font-medium text-foreground',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

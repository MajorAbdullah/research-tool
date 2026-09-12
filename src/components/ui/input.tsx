import { forwardRef, type InputHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export type InputProps = InputHTMLAttributes<HTMLInputElement>

/**
 * `text-base` here is deliberately the browser's actual 1rem/16px, not the
 * app's slightly-denser `--text-base` token — typed content should never
 * feel cramped just because display copy is dense elsewhere.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        'flex h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-base text-foreground',
        'placeholder:text-muted-foreground',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/40',
        className
      )}
      {...props}
    />
  )
})

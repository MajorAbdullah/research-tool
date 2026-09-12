import { forwardRef, type ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'
import { cva, type VariantPropsOf } from '@/components/ui/variants'

/**
 * Every size sits at or above the 44x44pt touch-target floor (h-11 = 2.75rem
 * = 44px) — this app's board is drag-and-drop on Android, and "small" UI
 * density is expressed through padding/gap/font-size here, never by
 * shrinking the tap height below that floor. `icon` is exactly 44x44.
 */
export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium',
    'transition-colors disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4',
    'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  ].join(' '),
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline: 'border border-input bg-transparent hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-4',
        sm: 'h-11 px-3 text-xs gap-1.5',
        lg: 'h-12 px-6 text-base',
        icon: 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

type ButtonVariantProps = VariantPropsOf<typeof buttonVariants>

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonVariantProps {}

// forwardRef (rather than a plain function component) so Button can be used
// as the child of DropdownMenuTrigger/DialogTrigger/SheetTrigger, which
// clone their child and attach a ref to it.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
})

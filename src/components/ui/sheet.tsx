'use client'

import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useId,
  useState,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { cva, type VariantPropsOf } from '@/components/ui/variants'
import { useDialogElement } from '@/components/ui/use-dialog-element'

interface SheetContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  titleId: string
  descriptionId: string
}

const SheetContext = createContext<SheetContextValue | null>(null)

function useSheetContext(component: string) {
  const ctx = useContext(SheetContext)
  if (!ctx) throw new Error(`<${component}> must be used inside <Sheet>`)
  return ctx
}

export interface SheetProps {
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
}

/**
 * An edge-anchored panel built on the same native `<dialog>` mechanics as
 * Dialog (see use-dialog-element.ts) — a Sheet is really "a Dialog docked to
 * an edge," so it reuses that hook rather than re-implementing focus
 * trapping/Escape/backdrop-click.
 */
export function Sheet({ children, open, onOpenChange, defaultOpen = false }: SheetProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const titleId = useId()
  const descriptionId = useId()
  const current = open ?? internalOpen

  const setOpen = (next: boolean) => {
    if (open == null) setInternalOpen(next)
    onOpenChange?.(next)
  }

  return (
    <SheetContext.Provider value={{ open: current, setOpen, titleId, descriptionId }}>
      {children}
    </SheetContext.Provider>
  )
}

export interface SheetTriggerProps {
  children: ReactElement<{ onClick?: (event: React.MouseEvent) => void }>
}

export function SheetTrigger({ children }: SheetTriggerProps) {
  const { setOpen } = useSheetContext('SheetTrigger')
  if (!isValidElement(children)) return children
  return cloneElement(children, {
    onClick: (event: React.MouseEvent) => {
      children.props.onClick?.(event)
      setOpen(true)
    },
  })
}

const sheetSideVariants = cva('', {
  variants: {
    side: {
      // Default: a bottom sheet on phones (thumb-reachable, matches the
      // native Android bottom-sheet idiom used everywhere on the platform
      // this app is used on) that becomes a conventional right-side panel
      // from `sm:` up — mobile-first responsive behavior with zero JS.
      responsive: [
        'inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-lg',
        'sm:top-0 sm:right-0 sm:bottom-0 sm:left-auto sm:h-full sm:max-h-none sm:w-full sm:max-w-sm sm:rounded-t-none sm:rounded-l-lg',
      ].join(' '),
      right: 'top-0 right-0 bottom-0 left-auto h-full w-full max-w-sm rounded-l-lg',
      left: 'top-0 bottom-0 left-0 h-full w-full max-w-sm rounded-r-lg',
      bottom: 'inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-lg',
      top: 'inset-x-0 top-0 max-h-[85vh] w-full rounded-b-lg',
    },
  },
  defaultVariants: { side: 'responsive' },
})

export interface SheetContentProps
  extends HTMLAttributes<HTMLDialogElement>,
    VariantPropsOf<typeof sheetSideVariants> {
  hideCloseButton?: boolean
}

export function SheetContent({ className, side, children, hideCloseButton, ...props }: SheetContentProps) {
  const { open, setOpen, titleId, descriptionId } = useSheetContext('SheetContent')
  const ref = useDialogElement(open, setOpen)

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={cn(
        'm-0 max-w-none overflow-y-auto border border-border bg-card p-6 text-card-foreground shadow-lg',
        'backdrop:bg-black/50',
        sheetSideVariants({ side }),
        className
      )}
      {...props}
    >
      {children}
      {!hideCloseButton && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close panel"
          className={cn(
            'absolute top-3 right-3 inline-flex size-touch items-center justify-center rounded-md text-muted-foreground',
            'outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring'
          )}
        >
          <X className="size-4" />
        </button>
      )}
    </dialog>
  )
}

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 flex flex-col gap-1 pr-8', className)} {...props} />
}

export function SheetTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = useSheetContext('SheetTitle')
  return <h2 id={titleId} className={cn('text-lg font-semibold text-foreground', className)} {...props} />
}

export function SheetDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId } = useSheetContext('SheetDescription')
  return <p id={descriptionId} className={cn('text-sm text-muted-foreground', className)} {...props} />
}

export function SheetFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
}

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
import { useDialogElement } from '@/components/ui/use-dialog-element'

interface DialogContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  titleId: string
  descriptionId: string
}

const DialogContext = createContext<DialogContextValue | null>(null)

function useDialogContext(component: string) {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error(`<${component}> must be used inside <Dialog>`)
  return ctx
}

export interface DialogProps {
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
}

/** Root. Uncontrolled by default; pass `open`+`onOpenChange` to control it. */
export function Dialog({ children, open, onOpenChange, defaultOpen = false }: DialogProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const titleId = useId()
  const descriptionId = useId()
  const current = open ?? internalOpen

  const setOpen = (next: boolean) => {
    if (open == null) setInternalOpen(next)
    onOpenChange?.(next)
  }

  return (
    <DialogContext.Provider value={{ open: current, setOpen, titleId, descriptionId }}>
      {children}
    </DialogContext.Provider>
  )
}

export interface DialogTriggerProps {
  children: ReactElement<{ onClick?: (event: React.MouseEvent) => void }>
}

/** Clones its single child (usually a `<Button>`) and wires it to open the dialog. */
export function DialogTrigger({ children }: DialogTriggerProps) {
  const { setOpen } = useDialogContext('DialogTrigger')
  if (!isValidElement(children)) return children
  return cloneElement(children, {
    onClick: (event: React.MouseEvent) => {
      children.props.onClick?.(event)
      setOpen(true)
    },
  })
}

export interface DialogContentProps extends HTMLAttributes<HTMLDialogElement> {
  /** Hide the built-in close button for a dialog that provides its own exit action. */
  hideCloseButton?: boolean
}

export function DialogContent({ className, children, hideCloseButton, ...props }: DialogContentProps) {
  const { open, setOpen, titleId, descriptionId } = useDialogContext('DialogContent')
  const ref = useDialogElement(open, setOpen)

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={cn(
        // Reset the UA stylesheet's own border/position, then apply ours.
        // No entrance animation here on purpose — see globals.css's note on
        // the app's one signature motion moment; every other transition in
        // this codebase (this included) stays a plain, instant-feeling
        // default rather than a second "moment."
        'm-auto w-[calc(100%-2rem)] max-w-lg rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg',
        'backdrop:bg-black/50',
        className
      )}
      {...props}
    >
      {children}
      {!hideCloseButton && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close dialog"
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

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 flex flex-col gap-1 pr-8', className)} {...props} />
}

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = useDialogContext('DialogTitle')
  return <h2 id={titleId} className={cn('text-lg font-semibold text-foreground', className)} {...props} />
}

export function DialogDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId } = useDialogContext('DialogDescription')
  return <p id={descriptionId} className={cn('text-sm text-muted-foreground', className)} {...props} />
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
}

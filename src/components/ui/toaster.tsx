'use client'

import { CircleCheckBig, TriangleAlert, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useToast, type ToastData, type ToastVariant } from '@/components/ui/use-toast'

const variantIcon: Record<ToastVariant, typeof CircleCheckBig | null> = {
  default: null,
  success: CircleCheckBig,
  warning: TriangleAlert,
  destructive: TriangleAlert,
}

const variantClass: Record<ToastVariant, string> = {
  default: 'border-border bg-card text-card-foreground',
  success: 'border-success/30 bg-success/10 text-foreground [&_svg]:text-success',
  warning: 'border-warning/30 bg-warning/10 text-foreground [&_svg]:text-warning',
  destructive: 'border-destructive/30 bg-destructive/10 text-foreground [&_svg]:text-destructive',
}

function ToastRow({ toast, onDismiss }: { toast: ToastData; onDismiss: (id: string) => void }) {
  const variant = toast.variant ?? 'default'
  const Icon = variantIcon[variant]

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex w-full items-start gap-3 rounded-lg border p-4 shadow-lg sm:w-96',
        variantClass[variant]
      )}
    >
      {Icon && <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        {toast.title && <p className="text-sm font-medium">{toast.title}</p>}
        {toast.description && <p className="mt-0.5 text-sm text-muted-foreground">{toast.description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className={cn(
          '-m-2.5 inline-flex size-touch shrink-0 items-center justify-center rounded-md text-muted-foreground',
          'outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
        )}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

/**
 * Mount once, at the app root (see layout.tsx) — `toast(...)` from
 * use-toast.ts works from anywhere once this is on the page. `aria-live`
 * makes new toasts announced without stealing focus, so a status update
 * never interrupts whatever the user was doing.
 */
export function Toaster() {
  const { toasts, dismiss } = useToast()

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
    >
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  )
}

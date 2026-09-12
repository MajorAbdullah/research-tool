'use client'

import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'

import { cn } from '@/lib/utils'

interface DropdownMenuContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.RefObject<HTMLElement | null>
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null)

function useDropdownMenuContext(component: string) {
  const ctx = useContext(DropdownMenuContext)
  if (!ctx) throw new Error(`<${component}> must be used inside <DropdownMenu>`)
  return ctx
}

export interface DropdownMenuProps {
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * Hand-rolled menu (Radix-free by request) — no native element gives us a
 * "click a button, get a floating list of actions" menu, so this is one of
 * the primitives that's a genuine small client component. Positioning is
 * deliberately simple (anchored under the trigger, no collision detection):
 * adding smart positioning would mean adding Floating UI or similar, which
 * the phase brief rules out.
 */
export function DropdownMenu({ children, open, onOpenChange }: DropdownMenuProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const triggerRef = useRef<HTMLElement | null>(null)
  const current = open ?? internalOpen

  const setOpen = (next: boolean) => {
    if (open == null) setInternalOpen(next)
    onOpenChange?.(next)
    if (!next) triggerRef.current?.focus()
  }

  return (
    <DropdownMenuContext.Provider value={{ open: current, setOpen, triggerRef }}>
      <div className="relative inline-block">{children}</div>
    </DropdownMenuContext.Provider>
  )
}

export interface DropdownMenuTriggerProps {
  children: ReactElement<{
    onClick?: (event: React.MouseEvent) => void
    ref?: React.Ref<HTMLElement>
    'aria-haspopup'?: boolean | 'menu'
    'aria-expanded'?: boolean
  }>
}

export function DropdownMenuTrigger({ children }: DropdownMenuTriggerProps) {
  const { open, setOpen, triggerRef } = useDropdownMenuContext('DropdownMenuTrigger')
  if (!isValidElement(children)) return children

  return cloneElement(children, {
    ref: triggerRef,
    onClick: (event: React.MouseEvent) => {
      children.props.onClick?.(event)
      setOpen(!open)
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
  })
}

export interface DropdownMenuContentProps extends HTMLAttributes<HTMLDivElement> {
  align?: 'start' | 'end'
}

export function DropdownMenuContent({ className, align = 'end', children, ...props }: DropdownMenuContentProps) {
  const { open, setOpen, triggerRef } = useDropdownMenuContext('DropdownMenuContent')
  const contentRef = useRef<HTMLDivElement>(null)

  // Close on outside pointerdown or Escape; focus the first item on open.
  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (contentRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    const firstItem = contentRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
    firstItem?.focus()

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, setOpen, triggerRef])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      contentRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []
    )
    const currentIndex = items.indexOf(document.activeElement as HTMLElement)

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      items[(currentIndex + 1) % items.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      items[(currentIndex - 1 + items.length) % items.length]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      items[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      items[items.length - 1]?.focus()
    }
  }

  if (!open) return null

  return (
    <div
      ref={contentRef}
      role="menu"
      onKeyDown={handleKeyDown}
      className={cn(
        'absolute z-50 mt-2 min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg',
        align === 'end' ? 'right-0' : 'left-0',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export interface DropdownMenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  onSelect?: () => void
  variant?: 'default' | 'destructive'
}

export function DropdownMenuItem({ className, onSelect, onClick, variant = 'default', ...props }: DropdownMenuItemProps) {
  const { setOpen } = useDropdownMenuContext('DropdownMenuItem')

  return (
    <button
      type="button"
      role="menuitem"
      onClick={(event) => {
        onClick?.(event)
        onSelect?.()
        setOpen(false)
      }}
      className={cn(
        'flex w-full min-h-11 items-center gap-2 rounded-sm px-2 py-2 text-left text-sm',
        'outline-none focus-visible:bg-accent focus-visible:text-accent-foreground hover:bg-accent hover:text-accent-foreground',
        'disabled:pointer-events-none disabled:opacity-50',
        variant === 'destructive' && 'text-destructive focus-visible:bg-destructive/10 hover:bg-destructive/10',
        className
      )}
      {...props}
    />
  )
}

export function DropdownMenuLabel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)} {...props} />
}

export function DropdownMenuSeparator({ className, ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr className={cn('my-1 border-border', className)} {...props} />
}

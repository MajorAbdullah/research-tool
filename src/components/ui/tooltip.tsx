'use client'

import { cloneElement, isValidElement, useState, type ReactElement } from 'react'

import { cn } from '@/lib/utils'

export interface TooltipProps {
  /** A single focusable element (button, link, icon-button) to describe. */
  children: ReactElement<{ 'aria-describedby'?: string }>
  /** Short, plain-language label — tooltips are for real meaning, not decoration. */
  label: string
  /** Stable, unique id for the bubble, supplied by the caller (same convention as Label's htmlFor/Checkbox's id) rather than generated internally. */
  id: string
  side?: 'top' | 'bottom'
  className?: string
}

/**
 * Small hand-rolled tooltip (Radix-free by request; unlike Dialog/Select/
 * Checkbox, no native element gives us a delayed, custom-positioned bubble,
 * so this is the one primitive here that's a real, if tiny, client
 * component). Shows on hover *and* keyboard focus — a hover-only tooltip is
 * invisible to keyboard users, which would fail "fully keyboard-operable."
 */
export function Tooltip({ children, label, id, side = 'top', className }: TooltipProps) {
  const [open, setOpen] = useState(false)

  const trigger = isValidElement(children) ? cloneElement(children, { 'aria-describedby': id }) : children

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {trigger}
      <span
        role="tooltip"
        id={id}
        className={cn(
          'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background',
          'opacity-0 transition-opacity duration-150',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          open && 'opacity-100',
          className
        )}
      >
        {label}
      </span>
    </span>
  )
}

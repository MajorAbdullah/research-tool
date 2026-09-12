'use client'

import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
} from 'react'

import { cn } from '@/lib/utils'

interface TabsContextValue {
  value: string
  setValue: (value: string) => void
  idBase: string
}

const TabsContext = createContext<TabsContextValue | null>(null)

function useTabsContext(component: string) {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error(`<${component}> must be used inside <Tabs>`)
  return ctx
}

export interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  defaultValue: string
  value?: string
  onValueChange?: (value: string) => void
}

/** Root. Uncontrolled by default (`defaultValue`); pass `value`+`onValueChange` to control it. */
export function Tabs({ defaultValue, value, onValueChange, className, children, ...props }: TabsProps) {
  const [internalValue, setInternalValue] = useState(defaultValue)
  const idBase = useId()
  const current = value ?? internalValue

  const setValue = (next: string) => {
    if (value == null) setInternalValue(next)
    onValueChange?.(next)
  }

  return (
    <TabsContext.Provider value={{ value: current, setValue, idBase }}>
      <div className={cn(className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  )
}

export function TabsList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-muted p-1 text-muted-foreground',
        className
      )}
      {...props}
    />
  )
}

export interface TabsTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  value: string
}

/** Arrow keys move focus *and* select — the ARIA APG "automatic activation" tabs pattern. */
export function TabsTrigger({ value, className, onKeyDown, ...props }: TabsTriggerProps) {
  const { value: active, setValue, idBase } = useTabsContext('TabsTrigger')
  const ref = useRef<HTMLButtonElement>(null)
  const selected = active === value

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return

    const list = ref.current?.closest('[role="tablist"]')
    if (!list) return
    const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'))
    const currentIndex = tabs.indexOf(ref.current!)
    if (currentIndex === -1) return

    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = tabs.length - 1

    if (nextIndex !== null) {
      event.preventDefault()
      const nextTab = tabs[nextIndex]
      nextTab?.focus()
      const nextValue = nextTab?.dataset.value
      if (nextValue) setValue(nextValue)
    }
  }

  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      id={`${idBase}-trigger-${value}`}
      aria-selected={selected}
      aria-controls={`${idBase}-content-${value}`}
      tabIndex={selected ? 0 : -1}
      data-value={value}
      onClick={() => setValue(value)}
      onKeyDown={handleKeyDown}
      className={cn(
        'inline-flex h-11 min-w-11 items-center justify-center rounded-sm px-3 text-sm font-medium whitespace-nowrap',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-50',
        selected ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground',
        className
      )}
      {...props}
    />
  )
}

export interface TabsContentProps extends HTMLAttributes<HTMLDivElement> {
  value: string
}

export function TabsContent({ value, className, ...props }: TabsContentProps) {
  const { value: active, idBase } = useTabsContext('TabsContent')
  if (active !== value) return null

  return (
    <div
      role="tabpanel"
      id={`${idBase}-content-${value}`}
      aria-labelledby={`${idBase}-trigger-${value}`}
      tabIndex={0}
      className={cn('mt-3 outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
      {...props}
    />
  )
}

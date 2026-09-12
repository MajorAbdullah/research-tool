'use client'

import { useSyncExternalStore } from 'react'

export type ToastVariant = 'default' | 'success' | 'warning' | 'destructive'

export interface ToastData {
  id: string
  title?: string
  description?: string
  variant?: ToastVariant
  /** ms before auto-dismiss; 0 disables auto-dismiss. Defaults to 4000. */
  duration?: number
}

type Listener = () => void

/**
 * Module-level store (not React context) so `toast(...)` can be called from
 * anywhere — an event handler, a TanStack Query `onError`, a plain utility
 * function — without needing a provider in scope. `useToast()` subscribes to
 * it via `useSyncExternalStore`, React's built-in primitive for exactly this
 * external-store shape, so no extra state-management dependency is needed.
 */
let toasts: ToastData[] = []
const listeners = new Set<Listener>()
let idCounter = 0

// A stable reference (not a fresh `[]` literal per call) — useSyncExternalStore
// requires getServerSnapshot/getSnapshot to return the *same* value when
// nothing changed, or it (rightly) assumes something changed on every render.
const EMPTY_TOASTS: ToastData[] = []

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return toasts
}

function getServerSnapshot() {
  return EMPTY_TOASTS
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

/** Push a toast. Callable from any client code, not just inside a component. */
export function toast(data: Omit<ToastData, 'id'>): string {
  const id = `toast-${++idCounter}`
  const duration = data.duration ?? 4000
  toasts = [...toasts, { id, ...data }]
  emit()
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration)
  }
  return id
}

export function useToast() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return { toasts: list, dismiss: dismissToast, toast }
}

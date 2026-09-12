import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge conditional class names and resolve conflicting Tailwind utilities.
 *
 * `clsx` collapses the usual conditional/array/object inputs into one string;
 * `twMerge` then dedupes conflicting Tailwind classes (e.g. `p-2 ... p-4`) so
 * the last one wins instead of both being emitted to the DOM. Every component
 * under `src/components/**` composes its class names through this helper
 * instead of concatenating strings by hand.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

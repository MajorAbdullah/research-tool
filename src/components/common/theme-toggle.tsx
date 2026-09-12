'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'

type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'sieve-theme'
const NEXT_MODE: Record<ThemeMode, ThemeMode> = { system: 'light', light: 'dark', dark: 'system' }
const MODE_ICON = { system: Monitor, light: Sun, dark: Moon } as const
const MODE_LABEL: Record<ThemeMode, string> = { system: 'System', light: 'Light', dark: 'Dark' }

/**
 * localStorage is an external store, so it is read through useSyncExternalStore
 * rather than copied into state inside an effect. Two reasons beyond satisfying
 * react-hooks/set-state-in-effect: there is no render-then-correct cascade, and
 * the `storage` event subscription makes the theme sync across tabs for free.
 *
 * `storage` does NOT fire in the tab that wrote the value, so writes also notify
 * local listeners explicitly.
 */
const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

function getSnapshot(): ThemeMode {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

/** The server cannot know the preference; layout.tsx's pre-paint script applies it. */
function getServerSnapshot(): ThemeMode {
  return 'system'
}

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement
  if (mode === 'system') {
    delete root.dataset.theme
    window.localStorage.removeItem(STORAGE_KEY)
  } else {
    root.dataset.theme = mode
    window.localStorage.setItem(STORAGE_KEY, mode)
  }
  for (const l of listeners) l()
}

/**
 * Three-way cycle (system -> light -> dark -> system) rather than a plain
 * on/off switch, so both override directions promised by globals.css's
 * `[data-theme]` mechanism are actually reachable from the UI, and "match my
 * OS" stays a real, returnable option rather than something only achievable
 * by clearing site data.
 *
 * Renders as "system" on the server (which cannot read localStorage) and
 * resolves to the stored preference on the client. layout.tsx's inline
 * pre-hydration script has already applied the correct `data-theme` before
 * paint, so this component only governs the icon/label — there is never a
 * flash of the wrong theme.
 */
export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const cycle = useCallback(() => applyTheme(NEXT_MODE[mode]), [mode])

  const Icon = MODE_ICON[mode]

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label={`Theme: ${MODE_LABEL[mode]}. Click to switch to ${MODE_LABEL[NEXT_MODE[mode]]}.`}
    >
      <Icon className="size-4" aria-hidden="true" />
    </Button>
  )
}

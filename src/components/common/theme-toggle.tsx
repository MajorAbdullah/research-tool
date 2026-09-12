'use client'

import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'

type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'sieve-theme'
const NEXT_MODE: Record<ThemeMode, ThemeMode> = { system: 'light', light: 'dark', dark: 'system' }
const MODE_ICON = { system: Monitor, light: Sun, dark: Moon } as const
const MODE_LABEL: Record<ThemeMode, string> = { system: 'System', light: 'Light', dark: 'Dark' }

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement
  if (mode === 'system') {
    delete root.dataset.theme
    window.localStorage.removeItem(STORAGE_KEY)
  } else {
    root.dataset.theme = mode
    window.localStorage.setItem(STORAGE_KEY, mode)
  }
}

/**
 * Three-way cycle (system -> light -> dark -> system) rather than a plain
 * on/off switch, so both override directions promised by globals.css's
 * `[data-theme]` mechanism are actually reachable from the UI, and "match my
 * OS" stays a real, returnable option rather than something only achievable
 * by clearing site data.
 *
 * Starts rendering as "system" on every request (server and first client
 * paint agree, so there's no hydration mismatch) and syncs to the real
 * stored preference in an effect — layout.tsx's inline pre-hydration script
 * already applied the correct `data-theme` before paint, so this is purely
 * about the icon/label catching up, not a flash of the wrong theme.
 */
export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>('system')

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') setMode(stored)
  }, [])

  const Icon = MODE_ICON[mode]

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => {
        const next = NEXT_MODE[mode]
        setMode(next)
        applyTheme(next)
      }}
      aria-label={`Theme: ${MODE_LABEL[mode]}. Click to switch to ${MODE_LABEL[NEXT_MODE[mode]]}.`}
    >
      <Icon className="size-4" aria-hidden="true" />
    </Button>
  )
}

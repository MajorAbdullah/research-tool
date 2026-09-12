import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Deliberately separate from vite.config.ts: that file exports an *array* of
// build configs (see the comment there), which is a build-only concept —
// Vitest wants one single config object.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    // These are pure-logic + fixture-DOM tests only (see README's Testing
    // section for what's deliberately NOT covered here) — no network, no
    // live browser, so this should always be fast.
    testTimeout: 5_000,
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})

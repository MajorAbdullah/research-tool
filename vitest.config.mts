import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    // e2e runs under Playwright, not Vitest
    exclude: ['**/node_modules/**', 'tests/e2e/**'],
    // Extractor tests run against recorded fixtures — the suite must stay offline and fast.
    testTimeout: 10_000,
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})

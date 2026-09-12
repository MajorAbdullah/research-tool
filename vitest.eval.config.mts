import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Evals are slow, hit real models, and are run deliberately — never in the default `pnpm test`.
// Retrieval and generation are scored separately on purpose (see CLAUDE.md → RAG).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['eval/**/*.eval.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    sequence: { concurrent: false },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})

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
    server: {
      deps: {
        // next-auth must be INLINED, not just aliased. The offending import lives inside
        // node_modules/next-auth/lib/env.js, which Vitest treats as external and never
        // transforms — so resolve.alias never gets a chance to rewrite it and Node's own
        // resolver rejects the extensionless "next/server". Inlining routes it through
        // Vite's pipeline where the alias below applies.
        inline: ['next-auth', '@auth/core'],
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // next-auth@5.0.0-beta.32 does `import { NextRequest } from "next/server"` with no
      // extension. Vite's ESM resolver rejects the extensionless specifier ("Did you mean
      // next/server.js?"), so ANY test that transitively imports src/lib/auth.ts fails to
      // load — which silently made auth untestable. Mapping the bare specifier to the real
      // file fixes it for every phase rather than each one mocking @/lib/auth separately.
      'next/server': fileURLToPath(new URL('./node_modules/next/server.js', import.meta.url)),
    },
  },
})

import type { NextConfig } from 'next'

const config: NextConfig = {
  // Single-container deploy: see docs/adr/0007-single-container-in-process-worker.md
  output: 'standalone',

  // Native modules must not be bundled — they load .node binaries at runtime.
  // better-sqlite3: the datastore. onnxruntime-node/fastembed: local embeddings.
  serverExternalPackages: ['better-sqlite3', 'sqlite-vec', 'onnxruntime-node', 'fastembed'],

  // NOTE: no `experimental.instrumentationHook` — that flag was removed in Next 15.
  // instrumentation.ts is stable and picked up automatically; adding the flag is a type error.

  // Next 16 removed `eslint` from NextConfig — the built-in lint integration is gone.
  // Linting runs via `pnpm lint` (eslint 10 + eslint-config-next) in CI instead.
  typescript: { ignoreBuildErrors: false },
}

export default config

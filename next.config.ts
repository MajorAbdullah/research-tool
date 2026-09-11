import type { NextConfig } from 'next'

const config: NextConfig = {
  // Single-container deploy: see docs/adr/0007-single-container-in-process-worker.md
  output: 'standalone',

  // Native modules must not be bundled — they load .node binaries at runtime.
  // better-sqlite3: the datastore. onnxruntime-node/fastembed: local embeddings.
  serverExternalPackages: ['better-sqlite3', 'sqlite-vec', 'onnxruntime-node', 'fastembed'],

  experimental: {
    // The background worker loop is started from instrumentation.ts in this same process.
    instrumentationHook: true,
  },

  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
}

export default config

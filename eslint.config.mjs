import next from 'eslint-config-next'

/**
 * `eslint-config-next` default-exports an ARRAY of flat configs
 * (`next`, `next/typescript`, plus an unnamed one) — it is not a callable.
 * Spread it; calling it throws "next is not a function".
 */
const config = [
  {
    ignores: [
      '.next/**',
      'dist/**',
      'extension/dist/**',
      'data/**',
      'drizzle/**',
      '.fastembed_cache/**',
      'playwright-report/**',
      'test-results/**',
      '.worktrees/**',
    ],
  },
  ...next,
]

export default config

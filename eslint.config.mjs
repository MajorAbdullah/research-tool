import next from 'eslint-config-next'

export default [
  ...next(),
  {
    ignores: ['.next/**', 'dist/**', 'extension/dist/**', 'data/**', 'drizzle/**'],
  },
  {
    rules: {
      // Every query must go through the user_id scoping helper (CLAUDE.md → Non-Negotiables).
      // Enforced in review; see src/repositories/ for the helper.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
]

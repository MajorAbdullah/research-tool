import type { Config } from 'drizzle-kit'

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: process.env.SQLITE_PATH ?? './data/sieve.db' },
  strict: true,
  verbose: true,
} satisfies Config

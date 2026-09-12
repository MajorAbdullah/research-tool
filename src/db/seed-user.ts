/**
 * `pnpm seed:user` — creates or updates the single seeded user from `SEED_USER_EMAIL` /
 * `SEED_USER_PASSWORD`. Idempotent: re-running with an unchanged password does nothing (not even
 * an UPDATE) — it verifies the stored hash against the configured password first, so a fresh
 * argon2 hash (a different string every time, by design — the salt is random) never gets written
 * unless the plaintext password actually changed.
 */

import { eq } from 'drizzle-orm'
import { getConfig } from '@/lib/config'
import { logger } from '@/lib/logger'
import { hashPassword, verifyPassword } from '@/lib/auth'
import { getDb, getSqlite } from './client'
import { runMigrations } from './migrate'
import { users } from './schema'

export type SeedUserAction = 'created' | 'updated' | 'unchanged'

export async function seedUser(): Promise<{ action: SeedUserAction; email: string }> {
  // Safe even if `pnpm db:migrate` hasn't been run yet on a brand new database — idempotent, and
  // cheap enough that guarding against ordering here costs nothing.
  runMigrations(getSqlite())

  const config = getConfig()
  const db = getDb()

  const existing = db.select().from(users).where(eq(users.email, config.seedUserEmail)).get()

  if (!existing) {
    const passwordHash = await hashPassword(config.seedUserPassword)
    db.insert(users).values({ email: config.seedUserEmail, passwordHash }).run()
    return { action: 'created', email: config.seedUserEmail }
  }

  const passwordUnchanged = await verifyPassword(existing.passwordHash, config.seedUserPassword)
  if (passwordUnchanged) {
    return { action: 'unchanged', email: config.seedUserEmail }
  }

  const passwordHash = await hashPassword(config.seedUserPassword)
  db.update(users).set({ passwordHash }).where(eq(users.id, existing.id)).run()
  return { action: 'updated', email: config.seedUserEmail }
}

// CLI entry point — `pnpm seed:user` runs `tsx src/db/seed-user.ts` directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  seedUser()
    .then(({ action, email }) => {
      logger.info({ action, email }, 'seed-user: done')
      process.exit(0)
    })
    .catch((err: unknown) => {
      logger.error({ err }, 'seed-user: failed')
      process.exit(1)
    })
}

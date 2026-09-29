/**
 * Next.js instrumentation hook — runs once when a new server instance boots, before it accepts
 * requests (node_modules/next/dist/docs/01-app/02-guides/instrumentation.md). This is Sieve's
 * boot sequence: validate env config, migrate the database, then start the in-process worker
 * loop (ADR 0007) — in that order, since the worker's first claim query would fail against a
 * database that hasn't been migrated yet.
 *
 * Guarded on `globalThis`, not a plain module-level flag: Next's dev server can re-evaluate this
 * module more than once, and without this guard that would re-run migration (harmless — it's
 * idempotent) but also register a second SIGTERM listener and invoke `startWorkerLoop` a second
 * time. `startWorkerLoop` already guards itself independently (see `src/worker/loop.ts`) — this
 * guard additionally makes sure the *rest* of boot (config validation, migration, the SIGTERM
 * listener) only ever runs once per process too.
 *
 * Runtime-heavy imports (`better-sqlite3`, argon2-adjacent config, the worker) are dynamically
 * imported *inside* `register`, after the `NEXT_RUNTIME` check, per Next's own documented
 * pattern for instrumentation files — this file is evaluated for every Next.js runtime (Node.js
 * and Edge), and native modules must never even be `require`d in a context that can't load them.
 */

declare global {
  // `var` is required for global augmentation merging; this is a type-only ambient declaration.

  var __sieveInstrumentationStarted: boolean | undefined
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  if (globalThis.__sieveInstrumentationStarted) return
  globalThis.__sieveInstrumentationStarted = true

  const { getConfig } = await import('@/lib/config')
  const { getSqlite } = await import('@/db/client')
  const { runMigrations } = await import('@/db/migrate')
  const { logger } = await import('@/lib/logger')
  const { startWorkerLoop, stopWorkerLoop } = await import('@/worker/loop')

  // Fails fast: an invalid/missing env var throws here, at boot, before the server accepts any
  // request — not later, on whichever request happens to be first to touch config.
  const config = getConfig()

  runMigrations(getSqlite())
  logger.info('boot: migrations applied')

  if (!config.workerEnabled) {
    logger.info('boot: WORKER_ENABLED=false — worker loop not started (see ADR 0007)')
    return
  }

  // Constructs the shared AI/embedding dependencies and installs the six real stage handlers
  // (P7) into the registry P1's worker loop dispatches through — must happen before
  // `startWorkerLoop()` claims its first job, or that job would run against P1's no-op
  // placeholders.
  const { bootstrapPipeline } = await import('@/worker/bootstrap')
  await bootstrapPipeline()

  startWorkerLoop()
  logger.info({ concurrency: 2 }, 'boot: worker loop started')

  process.once('SIGTERM', () => {
    logger.info('boot: SIGTERM received — draining worker loop before exit')
    stopWorkerLoop()
      .then(() => {
        logger.info('boot: worker loop drained, exiting')
        process.exit(0)
      })
      .catch((err: unknown) => {
        logger.error({ err }, 'boot: error while draining worker loop')
        process.exit(1)
      })
  })
}

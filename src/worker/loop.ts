/**
 * The in-process worker loop. Started once from `instrumentation.ts` at boot (see ADR 0007 —
 * one container, one process, worker + web server share it). Concurrency 2: two independent
 * "lanes" each loop claim -> dispatch -> complete/fail, polling when the queue is empty.
 *
 * Two things this file is deliberately careful about:
 *
 * 1. **Double-start.** Next.js's dev server re-evaluates `instrumentation.ts` on more than one
 *    trigger (and, per Next's own docs, `register()` must be safe to reason about as "called
 *    once" without the framework strictly guaranteeing a module-level guard survives every hot
 *    reload). A second independent loop would claim jobs concurrently with the first — not
 *    incorrect (claims are still atomic), but it doubles effective concurrency past the
 *    documented cap of 2 and defeats the point of the cap. `startWorkerLoop` guards on
 *    `globalThis`, which — unlike a plain module-level variable — survives ES module cache
 *    invalidation across a hot reload, exactly like `src/db/client.ts`'s connection guard.
 * 2. **Graceful shutdown.** SIGTERM must stop *claiming new* jobs but let whatever's already
 *    in-flight finish — killing a job mid-extraction/enrichment just means it retries from
 *    scratch on next boot, which is correct but wasteful. `stop()` flips an `AbortController`
 *    (lanes check it once per iteration, and it interrupts an in-progress poll sleep early) and
 *    resolves only once every lane's current iteration has actually finished.
 */

import { JobName } from '@/types/contracts'
import type { JobPayload } from '@/types/contracts'
import { getJobQueue, type JobRow } from '@/lib/queue'
import { dispatch } from './registry'
import { logger as defaultLogger, type Logger } from '@/lib/logger'

export const WORKER_CONCURRENCY = 2
export const DEFAULT_POLL_INTERVAL_MS = 1_000

export interface WorkerLoopDeps {
  claimNext: () => JobRow | null
  complete: (id: number) => void
  fail: (id: number, error: string) => void
  dispatch: (payload: JobPayload) => Promise<void>
  logger?: Logger
  pollIntervalMs?: number
  concurrency?: number
}

export interface WorkerLoopHandle {
  /** Stops claiming new jobs and resolves once every in-flight job has finished. */
  stop: () => Promise<void>
}

/** `ResolveJobPayload` has no `itemId` (an item doesn't exist yet at that stage); the rest do. */
function itemIdOf(payload: JobPayload): number | undefined {
  return payload.name === JobName.Resolve ? undefined : payload.itemId
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * Builds and immediately starts a worker loop against injected dependencies — the DI seam that
 * lets `tests/unit/worker/loop.test.ts` exercise concurrency/backoff/shutdown behavior with fake
 * queue functions, with no real database involved.
 */
export function createWorkerLoop(deps: WorkerLoopDeps): WorkerLoopHandle {
  const log = deps.logger ?? defaultLogger
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const concurrency = deps.concurrency ?? WORKER_CONCURRENCY
  const controller = new AbortController()

  async function runLane(laneId: number): Promise<void> {
    while (!controller.signal.aborted) {
      try {
        const job = deps.claimNext()
        if (!job) {
          await sleep(pollIntervalMs, controller.signal)
          continue
        }

        const jobLog = log.child({ jobId: job.id, jobName: job.name, itemId: itemIdOf(job.payload), lane: laneId })
        const startedAt = Date.now()
        jobLog.info('job.start')

        let handlerError: Error | undefined
        try {
          await deps.dispatch(job.payload)
        } catch (err) {
          handlerError = err instanceof Error ? err : new Error(String(err))
        }

        if (handlerError) {
          deps.fail(job.id, handlerError.message)
          jobLog.error({ durationMs: Date.now() - startedAt, err: handlerError }, 'job.failed')
        } else {
          deps.complete(job.id)
          jobLog.info({ durationMs: Date.now() - startedAt }, 'job.completed')
        }
      } catch (err) {
        // claimNext/complete/fail themselves threw (e.g. a transient DB error) — log and back
        // off rather than let one bad tick permanently kill this lane.
        log.error({ err, lane: laneId }, 'worker: lane error outside job dispatch')
        await sleep(pollIntervalMs, controller.signal)
      }
    }
  }

  const lanes = Array.from({ length: concurrency }, (_, laneId) => runLane(laneId))

  return {
    async stop() {
      controller.abort()
      await Promise.all(lanes)
    },
  }
}

declare global {
  // `var` is required for global augmentation merging; this is a type-only ambient declaration.
   
  var __sieveWorkerLoop: WorkerLoopHandle | undefined
}

/**
 * Starts the app-wide worker loop bound to the real job queue and registry. Idempotent: a
 * second call (including one triggered by a dev hot-reload) returns the already-running handle
 * instead of starting a second loop.
 */
export function startWorkerLoop(): WorkerLoopHandle {
  if (globalThis.__sieveWorkerLoop) {
    return globalThis.__sieveWorkerLoop
  }

  const queue = getJobQueue()
  const handle = createWorkerLoop({
    claimNext: () => queue.claimNext(),
    complete: (id) => {
      queue.complete(id)
    },
    fail: (id, error) => {
      queue.fail(id, error)
    },
    dispatch,
  })

  globalThis.__sieveWorkerLoop = handle
  return handle
}

/** Drains and clears the app-wide worker loop, if one is running. Safe to call when it isn't. */
export async function stopWorkerLoop(): Promise<void> {
  const handle = globalThis.__sieveWorkerLoop
  if (!handle) return
  globalThis.__sieveWorkerLoop = undefined
  await handle.stop()
}

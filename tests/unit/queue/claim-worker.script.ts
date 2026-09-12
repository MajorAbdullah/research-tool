/**
 * Companion process for `concurrent-claim.test.ts` — deliberately NOT named `*.test.ts`, so
 * vitest's own glob never picks it up as a test.
 *
 * Run as its own OS process (via `tsx`, see the test file), each invocation opens an
 * independent connection to the SAME on-disk SQLite file and races to claim every job it can.
 * This is what makes the atomicity test real: multiple genuine OS processes hammering one file,
 * not multiple async calls interleaved within a single Node event loop.
 *
 * Two things make the race actually overlap instead of one fast process finishing before the
 * others have even booted (tsx's per-process startup cost otherwise dwarfs a local claim query):
 *
 * 1. A crude file-based barrier — every worker writes `<barrierDir>/<id>.ready` as soon as it has
 *    its connection open, then busy-polls until it sees one such file per worker, so all workers
 *    start claiming at approximately the same wall-clock moment instead of staggered by however
 *    long each one took to cold-start.
 * 2. A tiny delay between claims, so a 40-job race takes long enough (tens of ms) for multiple
 *    processes to actually be mid-loop at the same time, rather than one process draining the
 *    entire queue in under a millisecond.
 *
 * Usage: tsx claim-worker.script.ts <sqlite-path> <barrier-dir> <worker-id> <worker-count>
 */
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { createJobQueue } from '@/lib/queue'

const [, , dbPath, barrierDir, workerIdRaw, workerCountRaw] = process.argv
if (!dbPath || !barrierDir || !workerIdRaw || !workerCountRaw) {
  throw new Error(
    'usage: tsx claim-worker.script.ts <sqlite-path> <barrier-dir> <worker-id> <worker-count>',
  )
}
const workerId = Number(workerIdRaw)
const workerCount = Number(workerCountRaw)

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('busy_timeout = 5000')
sqlite.pragma('foreign_keys = ON')

const queue = createJobQueue(sqlite)

function sleepSync(ms: number): void {
  const until = Date.now() + ms
  while (Date.now() < until) {
    // Deliberately busy — this process has nothing async to yield to, and the delay only needs
    // to be a couple of milliseconds to widen the contention window enough to matter.
  }
}

fs.writeFileSync(`${barrierDir}/${workerId}.ready`, '')
for (;;) {
  const readyCount = fs.readdirSync(barrierDir).length
  if (readyCount >= workerCount) break
  sleepSync(2)
}

const claimedIds: number[] = []
for (;;) {
  const job = queue.claimNext()
  if (!job) break
  claimedIds.push(job.id)
  sleepSync(2)
}

sqlite.close()
process.stdout.write(JSON.stringify(claimedIds))

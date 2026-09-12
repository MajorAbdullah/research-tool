/**
 * `GET /api/v1/health` — the one unauthenticated endpoint (docs/API.md §3.11), for Docker's
 * `HEALTHCHECK` and any uptime monitor.
 *
 * The HTTP status is driven **only** by `db.status`: 200 when the database is reachable, 503
 * otherwise. `disk`, `queue`, and `llm_quota` are informational and never flip the status code —
 * a full disk or a spent LLM budget aren't fixed by a container restart, and a spent budget is
 * an explicitly graceful daily condition (CLAUDE.md: "the system stays useful at zero budget"),
 * not a health problem. A monitor that wants to warn on those should read the sub-fields itself.
 *
 * This route only parses (nothing to parse — no input) and delegates to `getHealthReport()`
 * below; the actual db/disk/queue/quota introspection lives there, not inlined into `GET`.
 */

import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'
import { getSqlite } from '@/db/client'
import { logger } from '@/lib/logger'

interface DbHealth {
  status: 'ok' | 'error'
  wal_size_bytes: number
}

interface QueueHealth {
  status: 'ok' | 'error'
  pending: number
  oldest_pending_age_ms: number
  worker_enabled: boolean
}

interface DiskHealth {
  status: 'ok' | 'error'
  free_bytes: number
  total_bytes: number
}

interface LlmQuotaHealth {
  used_today: number
  cap: number
  interactive_reserve: number
  remaining_background: number
  remaining_interactive: number
  resets_at: number
}

interface HealthReport {
  status: 'ok' | 'error'
  db: DbHealth
  queue: QueueHealth
  disk: DiskHealth
  llm_quota: LlmQuotaHealth
}

function checkDb(): DbHealth {
  try {
    const sqlite = getSqlite()
    sqlite.prepare('SELECT 1').get()

    let walSizeBytes = 0
    try {
      walSizeBytes = fs.statSync(`${getConfig().sqlitePath}-wal`).size
    } catch {
      // No WAL sidecar yet (fresh DB, or it was just checkpointed) — 0 is the honest answer.
    }

    return { status: 'ok', wal_size_bytes: walSizeBytes }
  } catch (err) {
    logger.error({ err }, 'health: db check failed')
    return { status: 'error', wal_size_bytes: 0 }
  }
}

function checkQueue(): QueueHealth {
  const workerEnabled = getConfig().workerEnabled
  try {
    const sqlite = getSqlite()
    const row = sqlite
      .prepare<[], { pending: number; oldest_run_at: number | null }>(
        `SELECT COUNT(*) AS pending, MIN(run_at) AS oldest_run_at FROM jobs WHERE state = 'queued'`,
      )
      .get()

    const pending = row?.pending ?? 0
    const oldestPendingAgeMs = row?.oldest_run_at ? Math.max(0, Date.now() - row.oldest_run_at) : 0

    return {
      status: 'ok',
      pending,
      oldest_pending_age_ms: oldestPendingAgeMs,
      worker_enabled: workerEnabled,
    }
  } catch (err) {
    logger.error({ err }, 'health: queue check failed')
    return { status: 'error', pending: 0, oldest_pending_age_ms: 0, worker_enabled: workerEnabled }
  }
}

function checkDisk(): DiskHealth {
  try {
    const dir = path.dirname(getConfig().sqlitePath)
    const stats = fs.statfsSync(fs.existsSync(dir) ? dir : '.')
    return {
      status: 'ok',
      free_bytes: stats.bavail * stats.bsize,
      total_bytes: stats.blocks * stats.bsize,
    }
  } catch (err) {
    logger.error({ err }, 'health: disk check failed')
    return { status: 'error', free_bytes: 0, total_bytes: 0 }
  }
}

/**
 * `used_today` tracking (P3.1.5's persistent UTC-day budget counter in `settings`) isn't built
 * yet — P3 owns that. Until it lands, this reports the real `cap`/`interactive_reserve` from
 * config and an honest `used_today: 0`, so the shape on the wire is already correct for P8/P10's
 * consumers and only the live counter needs wiring up later, not the response shape.
 */
function checkLlmQuota(): LlmQuotaHealth {
  const config = getConfig()
  const usedToday = 0

  const now = new Date()
  const resetsAt = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  )

  return {
    used_today: usedToday,
    cap: config.llmDailyCap,
    interactive_reserve: config.llmInteractiveReserve,
    remaining_background: Math.max(
      0,
      config.llmDailyCap - config.llmInteractiveReserve - usedToday,
    ),
    remaining_interactive: Math.max(0, config.llmDailyCap - usedToday),
    resets_at: resetsAt,
  }
}

export function getHealthReport(): HealthReport {
  const db = checkDb()
  return {
    status: db.status,
    db,
    queue: checkQueue(),
    disk: checkDisk(),
    llm_quota: checkLlmQuota(),
  }
}

export async function GET(): Promise<NextResponse> {
  const report = getHealthReport()
  return NextResponse.json(report, { status: report.db.status === 'ok' ? 200 : 503 })
}

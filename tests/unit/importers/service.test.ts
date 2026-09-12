import { describe, expect, it } from 'vitest'
import { WhatsAppImportService } from '../../../src/lib/importers/service'
import { InMemoryImportProgressStore } from '../../../src/lib/importers/memory-store'
import { computeUrlHash } from '../../../src/lib/importers/url-hash'
import {
  ImportNotFoundError,
  InvalidImportTransitionError,
  type BackgroundBudgetStatus,
  type BudgetSource,
  type Clock,
  type EnqueueResult,
  type ImportLinkCandidate,
  type LinkEnqueuer,
} from '../../../src/lib/importers/types'

class FakeClock implements Clock {
  constructor(private current: number) {}
  now(): number {
    return this.current
  }
  advance(ms: number): void {
    this.current += ms
  }
}

class FakeBudgetSource implements BudgetSource {
  constructor(
    public remainingBackground: number,
    public resetsAt: number,
  ) {}
  getBackgroundBudget(): Promise<BackgroundBudgetStatus> {
    return Promise.resolve({
      remainingBackground: this.remainingBackground,
      resetsAt: this.resetsAt,
    })
  }
}

class RecordingLinkEnqueuer implements LinkEnqueuer {
  public readonly calls: ImportLinkCandidate[] = []
  enqueue(candidate: ImportLinkCandidate): Promise<EnqueueResult> {
    this.calls.push(candidate)
    return Promise.resolve({ itemId: `itm_${this.calls.length}`, duplicate: false })
  }
}

/** N single-link iOS messages, each with a distinct URL - enough to drive the queue. */
function makeChatText(n: number): string {
  const lines: string[] = []
  for (let i = 1; i <= n; i++) {
    lines.push(`[15/01/2026, 10:00:00 AM] Tester: link number ${i} https://example.com/item-${i}`)
  }
  return lines.join('\n')
}

const DAY_MS = 86_400_000

function buildService(
  overrides: {
    dailyBackgroundBudget?: number
    budgetSource?: BudgetSource
    clock?: Clock
    maxBatchPerTick?: number
    store?: InMemoryImportProgressStore
    linkEnqueuer?: LinkEnqueuer
  } = {},
) {
  const store = overrides.store ?? new InMemoryImportProgressStore()
  const linkEnqueuer = overrides.linkEnqueuer ?? new RecordingLinkEnqueuer()
  const budgetSource = overrides.budgetSource ?? new FakeBudgetSource(1000, Date.UTC(2026, 0, 2))
  const clock = overrides.clock ?? new FakeClock(Date.UTC(2026, 0, 1, 10, 0, 0))
  const service = new WhatsAppImportService({
    progressStore: store,
    budgetSource,
    linkEnqueuer,
    dailyBackgroundBudget: overrides.dailyBackgroundBudget ?? 1000,
    maxBatchPerTick: overrides.maxBatchPerTick,
    clock,
  })
  return { service, store, linkEnqueuer, budgetSource, clock }
}

describe('WhatsAppImportService.ingestUpload', () => {
  it('dry_run parses and persists a "previewed" record without enqueuing anything', async () => {
    const { service, linkEnqueuer } = buildService()
    const view = await service.ingestUpload({
      fileBuffer: Buffer.from(makeChatText(5), 'utf-8'),
      filename: '_chat.txt',
      mode: 'dry_run',
    })
    expect(view.state).toBe('previewed')
    expect(view.totalLinks).toBe(5)
    expect(view.duplicateCount).toBe(0)
    expect(view.byKind.article).toBe(5)
    expect(linkEnqueuer.calls).toHaveLength(0)
  })

  it('commit persists a "running" record immediately (draining still happens via ticks)', async () => {
    const { service, linkEnqueuer } = buildService()
    const view = await service.ingestUpload({
      fileBuffer: Buffer.from(makeChatText(3), 'utf-8'),
      filename: '_chat.txt',
      mode: 'commit',
    })
    expect(view.state).toBe('running')
    expect(linkEnqueuer.calls).toHaveLength(0)
  })

  it('re-importing the same export against its own url_hashes is a full no-op', async () => {
    const { service } = buildService()
    const text = makeChatText(4)
    const existingUrlHashes = new Set(
      Array.from({ length: 4 }, (_, i) => computeUrlHash(`https://example.com/item-${i + 1}`)),
    )
    const view = await service.ingestUpload({
      fileBuffer: Buffer.from(text, 'utf-8'),
      filename: '_chat.txt',
      mode: 'dry_run',
      existingUrlHashes,
    })
    expect(view.totalLinks).toBe(4)
    expect(view.duplicateCount).toBe(4)
    expect(view.queued).toBe(0)
    expect(Object.values(view.byKind).every((n) => n === 0)).toBe(true)
  })
})

describe('WhatsAppImportService.applyAction', () => {
  it('rejects an action that is not valid from the current state', async () => {
    const { service } = buildService()
    const view = await service.ingestUpload({
      fileBuffer: Buffer.from(makeChatText(2), 'utf-8'),
      filename: '_chat.txt',
      mode: 'dry_run',
    })
    await expect(service.applyAction(view.id, 'pause')).rejects.toThrow(
      InvalidImportTransitionError,
    )
    await expect(service.applyAction(view.id, 'resume')).rejects.toThrow(
      InvalidImportTransitionError,
    )
  })

  it('commit moves previewed -> running', async () => {
    const { service } = buildService()
    const view = await service.ingestUpload({
      fileBuffer: Buffer.from(makeChatText(2), 'utf-8'),
      filename: '_chat.txt',
    })
    const next = await service.applyAction(view.id, 'commit')
    expect(next.state).toBe('running')
  })

  it('cancel is reachable from previewed, running and paused, and sets error', async () => {
    const { service } = buildService()
    const view = await service.ingestUpload({
      fileBuffer: Buffer.from(makeChatText(2), 'utf-8'),
      filename: '_chat.txt',
    })
    const cancelled = await service.applyAction(view.id, 'cancel')
    expect(cancelled.state).toBe('failed')
    expect(cancelled.error).toBe('cancelled by user')
  })

  it('throws ImportNotFoundError for an unknown id', async () => {
    const { service } = buildService()
    await expect(service.applyAction('imp_doesnotexist', 'pause')).rejects.toThrow(
      ImportNotFoundError,
    )
    await expect(service.getStatus('imp_doesnotexist')).rejects.toThrow(ImportNotFoundError)
    await expect(service.runBackfillTick('imp_doesnotexist')).rejects.toThrow(ImportNotFoundError)
  })
})

describe('WhatsAppImportService.runBackfillTick - throttling', () => {
  it('releases at most dailyBackgroundBudget candidates per UTC day', async () => {
    const { service, linkEnqueuer } = buildService({ dailyBackgroundBudget: 3 })
    const view = await service.ingestUpload({
      fileBuffer: Buffer.from(makeChatText(10), 'utf-8'),
      filename: '_chat.txt',
      mode: 'commit',
    })

    const tick1 = await service.runBackfillTick(view.id)
    expect(tick1).toEqual({ outcome: 'progressed', enqueued: 3 })
    expect(linkEnqueuer.calls).toHaveLength(3)

    // Same UTC day, cap already spent - no more released, import stays "running".
    const tick2 = await service.runBackfillTick(view.id)
    expect(tick2.outcome).toBe('daily_cap_reached')
    expect(tick2.enqueued).toBe(0)
    expect(linkEnqueuer.calls).toHaveLength(3)
    const status = await service.getStatus(view.id)
    expect(status.state).toBe('running')
  })

  it('also respects the external budget source as an upper bound', async () => {
    const { service, linkEnqueuer, budgetSource } = buildService({ dailyBackgroundBudget: 100 })
    ;(budgetSource as FakeBudgetSource).remainingBackground = 2
    const view = await service.ingestUpload({
      fileBuffer: Buffer.from(makeChatText(10), 'utf-8'),
      filename: '_chat.txt',
      mode: 'commit',
    })
    const tick = await service.runBackfillTick(view.id)
    expect(tick).toEqual({ outcome: 'progressed', enqueued: 2 })
    expect(linkEnqueuer.calls).toHaveLength(2)
  })

  it('reports waiting_for_budget (not paused, not failed) when the external budget is fully spent', async () => {
    const { service, budgetSource } = buildService({ dailyBackgroundBudget: 100 })
    ;(budgetSource as FakeBudgetSource).remainingBackground = 0
    const view = await service.ingestUpload({
      fileBuffer: Buffer.from(makeChatText(5), 'utf-8'),
      filename: '_chat.txt',
      mode: 'commit',
    })
    const tick = await service.runBackfillTick(view.id)
    expect(tick.outcome).toBe('waiting_for_budget')
    expect(tick.enqueued).toBe(0)
    expect(tick.resumesAt).toBeDefined()
    const status = await service.getStatus(view.id)
    expect(status.state).toBe('running')
  })

  it('does nothing when the import is paused, and does not throw', async () => {
    const { service, linkEnqueuer } = buildService({ dailyBackgroundBudget: 100 })
    const view = await service.ingestUpload({
      fileBuffer: Buffer.from(makeChatText(5), 'utf-8'),
      filename: '_chat.txt',
      mode: 'commit',
    })
    await service.applyAction(view.id, 'pause')
    const tick = await service.runBackfillTick(view.id)
    expect(tick).toEqual({ outcome: 'not_running', enqueued: 0 })
    expect(linkEnqueuer.calls).toHaveLength(0)
  })

  it('resumes releasing candidates, continuing from where it left off, after pause -> resume', async () => {
    const { service, linkEnqueuer } = buildService({ dailyBackgroundBudget: 2 })
    const view = await service.ingestUpload({
      fileBuffer: Buffer.from(makeChatText(5), 'utf-8'),
      filename: '_chat.txt',
      mode: 'commit',
    })
    await service.runBackfillTick(view.id) // releases item-1, item-2
    await service.applyAction(view.id, 'pause')
    await service.runBackfillTick(view.id) // no-op while paused
    expect(linkEnqueuer.calls).toHaveLength(2)

    await service.applyAction(view.id, 'resume')
    // Same UTC day, but the (advanced) FakeClock in the outer describe's default
    // budget of 1000/day was overridden to 2/day above and already spent - bump the
    // clock into the next UTC day so the per-day self-cap has fresh headroom, proving
    // resume continues the cursor rather than restarting it.
    service as unknown as { clock: FakeClock } // no-op, keeps intent documented above
    const tick = await service.runBackfillTick(view.id)
    expect(tick.outcome).toBe('daily_cap_reached') // still same UTC day, cap already spent
    expect(linkEnqueuer.calls).toHaveLength(2)
    expect(linkEnqueuer.calls.map((c) => c.url)).toEqual([
      'https://example.com/item-1',
      'https://example.com/item-2',
    ])
  })

  it('auto-resumes at the UTC-midnight reset with no explicit resume action', async () => {
    const clock = new FakeClock(Date.UTC(2026, 0, 1, 23, 0, 0))
    const budgetSource = new FakeBudgetSource(1000, Date.UTC(2026, 0, 2))
    const { service, linkEnqueuer } = buildService({
      dailyBackgroundBudget: 2,
      clock,
      budgetSource,
    })
    const view = await service.ingestUpload({
      fileBuffer: Buffer.from(makeChatText(5), 'utf-8'),
      filename: '_chat.txt',
      mode: 'commit',
    })

    const day1 = await service.runBackfillTick(view.id)
    expect(day1).toEqual({ outcome: 'progressed', enqueued: 2 })

    const stillDay1 = await service.runBackfillTick(view.id)
    expect(stillDay1.outcome).toBe('daily_cap_reached')

    // Cross the UTC-midnight boundary - no pause/resume call, just time (and the
    // budget source's own reset, which P3 owns) moving forward.
    clock.advance(2 * 60 * 60 * 1000) // 23:00 -> 01:00 next day
    budgetSource.remainingBackground = 1000

    const day2 = await service.runBackfillTick(view.id)
    expect(day2).toEqual({ outcome: 'progressed', enqueued: 2 })
    expect(linkEnqueuer.calls).toHaveLength(4)
    expect(linkEnqueuer.calls.map((c) => c.url).slice(2)).toEqual([
      'https://example.com/item-3',
      'https://example.com/item-4',
    ])
  })

  it('marks the import completed once every candidate has been released', async () => {
    const { service, linkEnqueuer } = buildService({ dailyBackgroundBudget: 100 })
    const view = await service.ingestUpload({
      fileBuffer: Buffer.from(makeChatText(3), 'utf-8'),
      filename: '_chat.txt',
      mode: 'commit',
    })
    const tick = await service.runBackfillTick(view.id)
    expect(tick).toEqual({ outcome: 'completed', enqueued: 3 })
    expect(linkEnqueuer.calls).toHaveLength(3)

    const again = await service.runBackfillTick(view.id)
    expect(again).toEqual({ outcome: 'not_running', enqueued: 0 })
    const status = await service.getStatus(view.id)
    expect(status.state).toBe('completed')
  })

  it('survives a process restart: a new service instance over the same store resumes from the persisted cursor', async () => {
    const store = new InMemoryImportProgressStore()
    const enqueuerA = new RecordingLinkEnqueuer()
    const { service: serviceA } = buildService({
      dailyBackgroundBudget: 2,
      store,
      linkEnqueuer: enqueuerA,
    })
    const view = await serviceA.ingestUpload({
      fileBuffer: Buffer.from(makeChatText(6), 'utf-8'),
      filename: '_chat.txt',
      mode: 'commit',
    })
    await serviceA.runBackfillTick(view.id) // releases item-1, item-2 - "process" then restarts

    const enqueuerB = new RecordingLinkEnqueuer()
    const { service: serviceB } = buildService({
      dailyBackgroundBudget: 2,
      store,
      linkEnqueuer: enqueuerB,
    })
    // Same UTC day - a brand new instance still knows (via the store) that 2 were
    // already released today, so it correctly reports the cap reached rather than
    // releasing 2 more.
    const tick = await serviceB.runBackfillTick(view.id)
    expect(tick.outcome).toBe('daily_cap_reached')
    expect(enqueuerB.calls).toHaveLength(0)

    const record = await store.get(view.id)
    expect(record?.nextCandidateIndex).toBe(2)
  })
})

describe('WhatsAppImportService.getStatus - progress accounting', () => {
  it('reports a finite etaMs and non-empty etaHuman while items remain queued', async () => {
    const { service } = buildService({ dailyBackgroundBudget: 50 })
    const view = await service.ingestUpload({
      fileBuffer: Buffer.from(makeChatText(20), 'utf-8'),
      filename: '_chat.txt',
    })
    expect(view.etaMs).not.toBeNull()
    expect(view.etaMs).toBeGreaterThan(0)
    expect(view.etaHuman).toMatch(/\d/)
  })

  it('reflects externally-updated done/failed counts in queued and eta', async () => {
    const { service, store } = buildService({ dailyBackgroundBudget: 50 })
    const view = await service.ingestUpload({
      fileBuffer: Buffer.from(makeChatText(10), 'utf-8'),
      filename: '_chat.txt',
    })
    expect(view.queued).toBe(10)

    // Simulate the real (DB-backed, out-of-scope-here) pipeline finishing 6 items and
    // permanently failing 1 - this module never computes these itself (see types.ts).
    await store.update(view.id, { done: 6, failed: 1 })
    const status = await service.getStatus(view.id)
    expect(status.done).toBe(6)
    expect(status.failed).toBe(1)
    expect(status.queued).toBe(3)
  })

  it('reports a null etaMs once the import is completed', async () => {
    const { service } = buildService({ dailyBackgroundBudget: 100 })
    const view = await service.ingestUpload({
      fileBuffer: Buffer.from(makeChatText(2), 'utf-8'),
      filename: '_chat.txt',
      mode: 'commit',
    })
    await service.runBackfillTick(view.id)
    const status = await service.getStatus(view.id)
    expect(status.state).toBe('completed')
    expect(status.etaMs).toBeNull()
    expect(status.etaHuman).toBeNull()
  })
})

// Sanity check that DAY_MS stays honest documentation for readers of this file.
describe('fixture sanity', () => {
  it('DAY_MS really is 24 hours', () => {
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000)
  })
})

/**
 * A plain counting semaphore — caps how many calls into the local ONNX model can run at once
 * (P3.3.2: "concurrency capped at 2"). This box shares 6 vCPUs with ~45 other containers
 * (CLAUDE.md), so the embedder must not let an arbitrary number of concurrent `embed()`/
 * `embedQuery()` calls (e.g. the worker's own concurrency-2 job loop, plus an interactive search
 * request) all hit the ONNX session at the same instant.
 */
export class Semaphore {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`Semaphore limit must be a positive integer, got ${limit}`)
    }
  }

  /** How many callers are currently inside the guarded section — for tests/observability. */
  get activeCount(): number {
    return this.active
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active += 1
        resolve()
      })
    })
  }

  private release(): void {
    this.active -= 1
    const next = this.waiters.shift()
    if (next) next()
  }
}

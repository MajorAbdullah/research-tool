import type { ImportProgressStore, ImportRecordData } from './types'

/**
 * Reference / test-only implementation of {@link ImportProgressStore}. Keeps
 * everything in a `Map`, so state does NOT survive a process restart — that property
 * is exactly what the real, DB-backed implementation (outside P12's scope) must
 * provide instead. Used by this module's own unit tests and as a runnable example of
 * the port's contract for whoever wires up the real one.
 */
export class InMemoryImportProgressStore implements ImportProgressStore {
  private readonly records = new Map<string, ImportRecordData>()

  create(record: ImportRecordData): Promise<void> {
    if (this.records.has(record.id)) {
      return Promise.reject(new Error(`import already exists: ${record.id}`))
    }
    this.records.set(record.id, { ...record })
    return Promise.resolve()
  }

  get(id: string): Promise<ImportRecordData | null> {
    const record = this.records.get(id)
    return Promise.resolve(record ? { ...record } : null)
  }

  update(id: string, patch: Partial<ImportRecordData>): Promise<void> {
    const existing = this.records.get(id)
    if (!existing) {
      return Promise.reject(new Error(`import not found: ${id}`))
    }
    this.records.set(id, { ...existing, ...patch })
    return Promise.resolve()
  }
}

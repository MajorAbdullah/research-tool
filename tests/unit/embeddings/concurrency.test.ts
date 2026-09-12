import { describe, expect, it } from 'vitest'
import { Semaphore } from '@/lib/embeddings/concurrency'

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('Semaphore', () => {
  it('runs up to the limit concurrently', async () => {
    const sem = new Semaphore(2)
    const gate1 = deferred<void>()
    const gate2 = deferred<void>()

    const p1 = sem.run(async () => {
      await gate1.promise
      return 'one'
    })
    const p2 = sem.run(async () => {
      await gate2.promise
      return 'two'
    })

    // Both should have been let in immediately — limit is 2.
    expect(sem.activeCount).toBe(2)

    gate1.resolve()
    gate2.resolve()
    expect(await p1).toBe('one')
    expect(await p2).toBe('two')
    expect(sem.activeCount).toBe(0)
  })

  it('queues a third call until a slot frees up', async () => {
    const sem = new Semaphore(2)
    const gate1 = deferred<void>()
    const gate2 = deferred<void>()
    const order: string[] = []

    const p1 = sem.run(async () => {
      await gate1.promise
      order.push('one')
    })
    const p2 = sem.run(async () => {
      await gate2.promise
      order.push('two')
    })
    const p3 = sem.run(async () => {
      order.push('three')
    })

    // p3 must not have run yet — both slots are taken.
    await Promise.resolve()
    expect(order).toEqual([])
    expect(sem.activeCount).toBe(2)

    gate1.resolve()
    await p1
    // Releasing one slot should let p3 in.
    await p3
    expect(order).toEqual(['one', 'three'])

    gate2.resolve()
    await p2
    expect(order).toEqual(['one', 'three', 'two'])
  })

  it('releases the slot even when the guarded function throws', async () => {
    const sem = new Semaphore(1)
    await expect(
      sem.run(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(sem.activeCount).toBe(0)

    // A slot should still be available afterwards.
    const result = await sem.run(async () => 'ok')
    expect(result).toBe('ok')
  })

  it('rejects a non-positive limit', () => {
    expect(() => new Semaphore(0)).toThrow()
    expect(() => new Semaphore(-1)).toThrow()
  })
})

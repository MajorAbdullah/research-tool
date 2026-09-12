/**
 * Integration tests for `POST /api/v1/capture` and its Android PWA share-target front door,
 * against a real in-memory SQLite (`tests/helpers/db.ts`) with the actual migration applied —
 * exercising the real route handlers end to end, not just the service functions.
 *
 * `@/lib/auth` is mocked (see below) purely to work around an environment issue this phase
 * discovered, unrelated to anything this phase built: `next-auth@5.0.0-beta.32`'s
 * `next-auth/lib/env.js` does `import { NextRequest } from "next/server"` without a file
 * extension, which Vitest/Vite's resolver refuses ("Cannot find module '.../next/server'... Did
 * you mean to import "next/server.js"?") even though `next` has no `exports` map restricting it
 * and the exact same specifier resolves fine when imported directly. This reproduces with a bare
 * `import('next-auth')` — nothing to do with this phase's code — and would block ANY test
 * (this phase's or another's) that imports `src/lib/auth.ts` transitively. See this phase's final
 * report. The mock below reimplements just enough of `auth()`/`verifyExtensionToken()`'s
 * observable behavior (session lookup, constant-shape bearer check against the real configured
 * token) to test this phase's own routes faithfully without hitting that import.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfig } from '@/lib/config'
import { makeTestDb, type TestDb } from '../helpers/db'

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(),
  verifyExtensionToken: vi.fn(),
}))

// Imported AFTER the mock so these resolve to the mocked module.
import { auth, verifyExtensionToken } from '@/lib/auth'
import { POST as capturePost } from '@/app/api/v1/capture/route'
import { POST as sharePost } from '@/app/share/route'

const SEED_USER_ID = 1
const SESSION = { user: { id: String(SEED_USER_ID) } }

let db: TestDb

// One connection for the whole file, not one per test: `src/db/client.ts`'s `getDb()` caches its
// Drizzle wrapper in a plain module-level variable (not `globalThis`), so swapping
// `globalThis.__sieveSqlite` to a NEW connection between tests would leave that cached wrapper
// silently bound to the FIRST test's now-orphaned connection for the rest of the file. Instead,
// the connection is created once and each test clears its own data via `beforeEach` below.
beforeAll(() => {
  db = makeTestDb()
  // `getSqlite()`/`getDb()` (src/db/client.ts) are guarded on `globalThis`, exactly so a test
  // can substitute an in-memory connection this way instead of touching the app's real
  // configured SQLITE_PATH — see that file's own header.
  globalThis.__sieveSqlite = db
  db.prepare(`insert into users (id, email, password_hash, created_at) values (?, ?, 'x', ?)`).run(
    SEED_USER_ID,
    getConfig().seedUserEmail,
    Date.now(),
  )
})

afterAll(() => {
  db.close()
  globalThis.__sieveSqlite = undefined
})

beforeEach(() => {
  db.exec('delete from jobs; delete from item_tags; delete from item_topics; delete from items;')

  vi.mocked(auth)
    .mockReset()
    .mockResolvedValue(SESSION as never)
  vi.mocked(verifyExtensionToken)
    .mockReset()
    .mockImplementation((request: Request) => {
      const header = request.headers.get('authorization')
      const token = header?.startsWith('Bearer ') ? header.slice(7) : null
      return token === getConfig().extensionToken
    })
})

function jobsRows(): { name: string; payload: string }[] {
  return db.prepare('select name, payload from jobs').all() as { name: string; payload: string }[]
}

function itemsCount(): number {
  return (db.prepare('select count(*) c from items').get() as { c: number }).c
}

function captureRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3060/api/v1/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/capture', () => {
  it('creates exactly one queued item and enqueues exactly one extract job', async () => {
    const res = await capturePost(
      captureRequest({ url: 'https://example.com/a', surface: 'web' }) as never,
    )

    expect(res.status).toBe(202)
    const body = (await res.json()) as { id: string; status: string; duplicate: boolean }
    expect(body.status).toBe('queued')
    expect(body.duplicate).toBe(false)
    expect(body.id).toMatch(/^itm_\d+$/)

    expect(itemsCount()).toBe(1)
    const row = db.prepare('select * from items').get() as Record<string, unknown>
    expect(row.status).toBe('queued')
    expect(row.source_surface).toBe('web')

    const jobs = jobsRows()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.name).toBe('extract')
    expect(JSON.parse(jobs[0]?.payload ?? '{}')).toMatchObject({ name: 'extract', itemId: row.id })
  })

  it('a duplicate capture returns the same id without creating a second row', async () => {
    const first = await capturePost(
      captureRequest({ url: 'https://example.com/b', surface: 'web' }) as never,
    )
    const firstBody = (await first.json()) as { id: string }

    const second = await capturePost(
      captureRequest({ url: 'https://example.com/b', surface: 'web' }) as never,
    )
    expect(second.status).toBe(202)
    const secondBody = (await second.json()) as { id: string; duplicate: boolean }

    expect(secondBody.id).toBe(firstBody.id)
    expect(secondBody.duplicate).toBe(true)
    expect(itemsCount()).toBe(1)
    // No fresh html/transcript/caption on the re-POST — only one extract job should ever exist.
    expect(jobsRows()).toHaveLength(1)
  })

  it('a duplicate WITH fresh transcript re-triggers extraction', async () => {
    const first = await capturePost(
      captureRequest({ url: 'https://example.com/c', surface: 'extension' }) as never,
    )
    const firstBody = (await first.json()) as { id: string }
    expect(jobsRows()).toHaveLength(1) // just the initial extract, no hint

    const second = await capturePost(
      captureRequest({
        url: 'https://example.com/c',
        surface: 'extension',
        transcript: '[00:00] a fresh transcript nobody had before',
      }) as never,
    )
    expect(second.status).toBe(202)
    const secondBody = (await second.json()) as { id: string; status: string; duplicate: boolean }

    expect(secondBody.id).toBe(firstBody.id)
    expect(secondBody.duplicate).toBe(true)
    // Re-triggered: status reported back as queued, even though the item already existed.
    expect(secondBody.status).toBe('queued')
    expect(itemsCount()).toBe(1) // still no second row

    const jobs = jobsRows()
    expect(jobs).toHaveLength(2) // the original extract, plus the re-triggered one
    const latestPayload = JSON.parse(jobs[1]?.payload ?? '{}') as {
      name: string
      itemId: number
      hint?: { transcript?: string }
    }
    expect(latestPayload.name).toBe('extract')
    expect(latestPayload.hint?.transcript).toBe('[00:00] a fresh transcript nobody had before')

    // The fresh content is also persisted on the item itself (raw_payload.clientCapture), so a
    // later retry-without-a-fresh-hint can still fall back to it.
    const row = db
      .prepare('select raw_payload from items where id = ?')
      .get(Number(firstBody.id.replace('itm_', ''))) as { raw_payload: string }
    const rawPayload = JSON.parse(row.raw_payload) as { clientCapture?: { transcript?: string } }
    expect(rawPayload.clientCapture?.transcript).toBe(
      '[00:00] a fresh transcript nobody had before',
    )
  })

  it('does NOT re-trigger extraction on a duplicate once the item already reached full tier', async () => {
    const first = await capturePost(
      captureRequest({ url: 'https://example.com/full', surface: 'web' }) as never,
    )
    const firstBody = (await first.json()) as { id: string }
    const rowId = Number(firstBody.id.replace('itm_', ''))
    db.prepare(`update items set extraction_tier = 'full' where id = ?`).run(rowId)

    const second = await capturePost(
      captureRequest({
        url: 'https://example.com/full',
        surface: 'web',
        transcript: 'too late, already full',
      }) as never,
    )
    const secondBody = (await second.json()) as { duplicate: boolean }
    expect(secondBody.duplicate).toBe(true)
    // Still just the one original job — a `full` item has nothing left to upgrade.
    expect(jobsRows()).toHaveLength(1)
  })

  it('rejects a missing bearer token with 401 UNAUTHORIZED', async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    const res = await capturePost(
      captureRequest({ url: 'https://example.com/d', surface: 'extension' }) as never,
    )

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string; request_id: string } }
    expect(body.error.code).toBe('UNAUTHORIZED')
    expect(body.error.request_id).toMatch(/^req_/)
    expect(itemsCount()).toBe(0)
  })

  it('rejects an invalid bearer token with 401 UNAUTHORIZED', async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    const res = await capturePost(
      captureRequest(
        { url: 'https://example.com/e', surface: 'extension' },
        { Authorization: 'Bearer not-the-real-token' },
      ) as never,
    )

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHORIZED')
    expect(itemsCount()).toBe(0)
  })

  it('accepts a valid bearer token with no session', async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    const res = await capturePost(
      captureRequest(
        { url: 'https://example.com/f', surface: 'extension' },
        { Authorization: `Bearer ${getConfig().extensionToken}` },
      ) as never,
    )

    expect(res.status).toBe(202)
    expect(itemsCount()).toBe(1)
  })

  it('rejects a payload over the 2 MB cap with 413 PAYLOAD_TOO_LARGE', async () => {
    const oversizedNote = 'x'.repeat(2_100_000)
    const res = await capturePost(
      captureRequest({
        url: 'https://example.com/g',
        surface: 'web',
        note: oversizedNote,
      }) as never,
    )

    expect(res.status).toBe(413)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE')
    expect(itemsCount()).toBe(0)
  })

  it('rejects a missing url with 400 VALIDATION_ERROR and never leaks internals', async () => {
    const res = await capturePost(captureRequest({ surface: 'web' }) as never)

    expect(res.status).toBe(400)
    const body = (await res.json()) as {
      error: {
        code: string
        message: string
        details: { field: string; reason: string }
        request_id: string
      }
    }
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.details.field).toBe('url')
    expect(typeof body.error.details.reason).toBe('string')
    expect(body.error.request_id).toMatch(/^req_/)
    expect(JSON.stringify(body)).not.toMatch(/at Object|node_modules|\.ts:\d+/)
  })
})

describe('POST /share (Android Web Share Target)', () => {
  function shareRequest(fields: Record<string, string>): Request {
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) form.set(key, value)
    return new Request('http://localhost:3060/share', { method: 'POST', body: form })
  }

  it('parses a URL buried inside `text` (the Instagram/Android quirk) and keeps the rest as a note', async () => {
    const res = await sharePost(
      shareRequest({
        title: 'this changes everything',
        text: 'Check this out: https://www.instagram.com/reel/Cxyz123/ so cool right?',
        url: '',
      }) as never,
    )

    expect(res.status).toBe(303)
    const location = new URL(res.headers.get('location') ?? '', 'http://localhost:3060')
    expect(location.pathname).toBe('/capture/confirm')
    expect(location.searchParams.get('error')).toBeNull()
    const id = location.searchParams.get('id')
    expect(id).toMatch(/^itm_\d+$/)

    expect(itemsCount()).toBe(1)
    const row = db.prepare('select * from items').get() as Record<string, unknown>
    expect(row.url).toBe('https://www.instagram.com/reel/Cxyz123/')
    expect(row.source_surface).toBe('pwa')
    expect(row.note).toBe('Check this out: so cool right?')
  })

  it('uses the `url` field directly when present and valid', async () => {
    const res = await sharePost(
      shareRequest({
        title: 't',
        text: 'a caption',
        url: 'https://example.com/shared-directly',
      }) as never,
    )
    expect(res.status).toBe(303)
    const row = db.prepare('select * from items').get() as Record<string, unknown>
    expect(row.url).toBe('https://example.com/shared-directly')
    expect(row.note).toBe('a caption')
  })

  it('redirects with an error when no URL can be found anywhere', async () => {
    const res = await sharePost(
      shareRequest({ title: '', text: 'no link here at all', url: '' }) as never,
    )
    expect(res.status).toBe(303)
    const location = new URL(res.headers.get('location') ?? '', 'http://localhost:3060')
    expect(location.searchParams.get('error')).toBe('no_url')
    expect(itemsCount()).toBe(0)
  })
})

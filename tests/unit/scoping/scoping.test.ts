import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { items, users } from '@/db/schema'
import { requireUserId, ScopingError, scopedTo } from '@/repositories/scoping'
import { createScratchDb } from '../test-helpers/scratch-db'

describe('requireUserId', () => {
  it('accepts a numeric-string session id and returns it as a number', () => {
    expect(requireUserId('42')).toBe(42)
  })

  it('accepts a plain number', () => {
    expect(requireUserId(7)).toBe(7)
  })

  it('rejects null, undefined, and an empty string — "no session" must never become userId=NaN', () => {
    expect(() => requireUserId(null)).toThrow(ScopingError)
    expect(() => requireUserId(undefined)).toThrow(ScopingError)
    expect(() => requireUserId('')).toThrow(ScopingError)
  })

  it('rejects a non-numeric or non-positive id instead of silently coercing it', () => {
    expect(() => requireUserId('not-a-number')).toThrow(ScopingError)
    expect(() => requireUserId(0)).toThrow(ScopingError)
    expect(() => requireUserId(-1)).toThrow(ScopingError)
  })
})

describe('scopedTo', () => {
  it('scopes a query to one user and never returns another user’s rows', () => {
    const sqlite = createScratchDb()
    const db = drizzle(sqlite)

    const [userA] = db
      .insert(users)
      .values({ email: 'a@example.com', passwordHash: 'x' })
      .returning()
      .all()
    const [userB] = db
      .insert(users)
      .values({ email: 'b@example.com', passwordHash: 'x' })
      .returning()
      .all()
    if (!userA || !userB) throw new Error('expected both users to be inserted')

    db.insert(items)
      .values({
        userId: userA.id,
        url: 'https://example.com/a',
        canonicalUrl: 'https://example.com/a',
        urlHash: 'hash-a',
        kind: 'article',
        sourceSurface: 'web',
      })
      .run()
    db.insert(items)
      .values({
        userId: userB.id,
        url: 'https://example.com/b',
        canonicalUrl: 'https://example.com/b',
        urlHash: 'hash-b',
        kind: 'article',
        sourceSurface: 'web',
      })
      .run()

    const userAItems = db.select().from(items).where(scopedTo(items.userId, userA.id)).all()
    expect(userAItems).toHaveLength(1)
    expect(userAItems[0]?.url).toBe('https://example.com/a')

    const userBItems = db.select().from(items).where(scopedTo(items.userId, userB.id)).all()
    expect(userBItems).toHaveLength(1)
    expect(userBItems[0]?.url).toBe('https://example.com/b')
  })

  it('combines with an extra condition via AND, dropping undefined filters', () => {
    const sqlite = createScratchDb()
    const db = drizzle(sqlite)
    const [user] = db
      .insert(users)
      .values({ email: 'a@example.com', passwordHash: 'x' })
      .returning()
      .all()
    if (!user) throw new Error('expected a user to be inserted')

    db.insert(items)
      .values({
        userId: user.id,
        url: 'https://example.com/gh',
        canonicalUrl: 'https://example.com/gh',
        urlHash: 'hash-gh',
        kind: 'github',
        sourceSurface: 'web',
      })
      .run()
    db.insert(items)
      .values({
        userId: user.id,
        url: 'https://example.com/vid',
        canonicalUrl: 'https://example.com/vid',
        urlHash: 'hash-vid',
        kind: 'video',
        sourceSurface: 'web',
      })
      .run()

    const githubOnly = db
      .select()
      .from(items)
      .where(scopedTo(items.userId, user.id, eq(items.kind, 'github')))
      .all()
    expect(githubOnly).toHaveLength(1)
    expect(githubOnly[0]?.kind).toBe('github')

    // An `undefined` extra condition (the common "no filter selected" case) must not exclude
    // everything — this is what lets a repository write
    // `scopedTo(items.userId, userId, kind ? eq(items.kind, kind) : undefined)` without an `if`.
    const noExtraFilter = db
      .select()
      .from(items)
      .where(scopedTo(items.userId, user.id, undefined))
      .all()
    expect(noExtraFilter).toHaveLength(2)
  })
})

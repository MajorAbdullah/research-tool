/**
 * Auth.js v5 setup: a single credentials provider (argon2), JWT sessions (no adapter — Sieve
 * seeds exactly one `users` row and never persists Auth.js's own session/account tables), plus
 * the `EXTENSION_TOKEN` bearer-auth helper used by the capture surface.
 *
 * No user enumeration (CLAUDE.md/plan 1.3.1): an unknown email and a wrong password for a known
 * email both (a) return the exact same generic failure to the client, and (b) take statistically
 * similar time — `authorize` always performs one argon2 verify, against the real stored hash when
 * the email is known or a fixed dummy hash when it isn't, so there's no "unknown email returned
 * instantly, wrong password took 80ms" timing tell.
 */

import { timingSafeEqual } from 'node:crypto'
import argon2 from 'argon2'
import NextAuth, { type DefaultSession } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { users } from '@/db/schema'
import { getConfig } from '@/lib/config'

declare module 'next-auth' {
  interface Session {
    user: { id: string } & DefaultSession['user']
  }
}

// ---------------------------------------------------------------------------
// Password hashing (argon2id, library defaults — OWASP-recommended parameters;
// see node_modules/argon2's own documented defaults. Never overridden down for "speed".)
// ---------------------------------------------------------------------------

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id })
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password)
}

/**
 * A fixed, precomputed argon2id hash of an arbitrary constant string — never a real user's
 * password. `authorize` verifies against this when the submitted email doesn't match any user,
 * so "no such user" costs the same one argon2 verification as "wrong password for a real user".
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$CnqARuib5Zy/GplaR5kC9w$p7WUIunqo2kANMMDSlTECMcwzWMvtOEWYCmcEiJGh/0'

// ---------------------------------------------------------------------------
// NextAuth
// ---------------------------------------------------------------------------

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  trustHost: true,
  secret: getConfig().authSecret,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = typeof credentials.email === 'string' ? credentials.email : undefined
        const password = typeof credentials.password === 'string' ? credentials.password : undefined
        if (!email || !password) return null

        const found = getDb().select().from(users).where(eq(users.email, email)).get()

        // Always run exactly one argon2 verify, win or lose — see file header on enumeration.
        const passwordMatches = await verifyPassword(found?.passwordHash ?? DUMMY_HASH, password)
        if (!found || !passwordMatches) return null

        return { id: String(found.id), email: found.email }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id
      }
      return token
    },
    async session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub
      }
      return session
    },
  },
}))

// ---------------------------------------------------------------------------
// Extension / PWA bearer auth (docs/API.md §1.2) — verification helper only; the
// `POST /api/v1/capture` route itself is built in another phase.
// ---------------------------------------------------------------------------

/** Constant-time string compare — resistant to a length- or content-based timing side-channel. */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    // Still perform a same-cost comparison so a length mismatch doesn't return measurably
    // faster than a same-length-but-wrong-content token would.
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

/**
 * Verifies the `Authorization: Bearer <EXTENSION_TOKEN>` header used by the browser extension
 * and the Android PWA share target — the one alternative to a session cookie, and only ever
 * valid on `POST /api/v1/capture` (docs/API.md §1.2).
 */
export function verifyExtensionToken(request: Request): boolean {
  const header = request.headers.get('authorization')
  if (!header) return false

  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) return false

  return safeCompare(token, getConfig().extensionToken)
}

/**
 * Route gate for everything except `/login`, `/api/v1/health`, and Auth.js's own `/api/auth/*`
 * endpoints. `POST /api/v1/capture` additionally accepts the `EXTENSION_TOKEN` bearer header
 * (the extension and PWA have no browser session) alongside the normal session cookie.
 *
 * Named `proxy.ts`, not `middleware.ts`: Next.js 16 deprecated the `middleware` file convention
 * in favor of `proxy` (same behavior, new name — see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md, "Migration
 * to Proxy"). The task that specified this phase's scope predates that rename and names the file
 * `middleware.ts`; this repo pins the Next.js version where that name is deprecated (and
 * `next dev`/`next build` print a nag warning on every request if both files somehow coexist), so
 * this file uses the current convention instead. Functionally identical either way — see this
 * phase's final report for the explicit callout.
 *
 * Proxy files always run on the Node.js runtime as of this Next.js version (no `export const
 * runtime` needed or allowed here), so there is no Edge-bundling concern with `auth.ts` pulling
 * in argon2/better-sqlite3 through this file's import graph.
 */

import { NextResponse } from 'next/server'
import { auth, verifyExtensionToken } from '@/lib/auth'

function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/api/v1/health' ||
    pathname.startsWith('/api/auth/') ||
    // P8 addition — see src/app/share/route.ts's file header. Android's Web Share Target POST is
    // a browser-native top-level navigation the OS constructs directly: it cannot carry a custom
    // Authorization header, and docs/API.md §1.2 explicitly notes an installed standalone PWA
    // isn't guaranteed to attach a session cookie to it either. There is no credential this gate
    // could check on that inbound request, so /share is carved out the same way
    // /api/v1/health is, and authenticates callers internally instead (resolveSeededUserId()).
    pathname === '/share'
  )
}

function acceptsBearerToken(pathname: string): boolean {
  return pathname === '/api/v1/capture'
}

function unauthorizedJson(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid credentials.',
        details: null,
        request_id: crypto.randomUUID(),
      },
    },
    { status: 401 },
  )
}

export default auth((request) => {
  const { pathname } = request.nextUrl

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  const hasSession = request.auth !== null

  if (acceptsBearerToken(pathname)) {
    if (hasSession || verifyExtensionToken(request)) {
      return NextResponse.next()
    }
    return unauthorizedJson()
  }

  if (hasSession) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/')) {
    return unauthorizedJson()
  }

  return NextResponse.redirect(new URL('/login', request.url), 302)
})

export const config = {
  // Everything except Next's own static/image internals and the favicon — including every
  // `/api/*` route, since that's exactly where this file's auth decisions apply.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

/**
 * Auth.js's own route handler — session cookie refresh, CSRF token endpoint, sign-out, etc.
 * The credentials sign-in itself happens through a Server Action (see the login page), which
 * calls into the same `NextAuth(...)` config directly rather than round-tripping through this
 * route — but the route still needs to exist for the rest of Auth.js's client-side machinery
 * (and any future OAuth/passkey provider) to work at all.
 */
import { handlers } from '@/lib/auth'

export const { GET, POST } = handlers

/**
 * The Android PWA Web Share Target action (`public/manifest.webmanifest`'s `share_target`,
 * docs/API.md's `/share` callout in §1.2). Android invokes this as a real browser top-level
 * navigation (multipart POST) when the user shares into the installed "Sieve" app from Instagram,
 * a browser, etc. — it is NOT a fetch/XHR call this codebase controls, so it cannot carry a
 * custom `Authorization` header, and per docs/API.md's own note, an installed standalone PWA
 * isn't guaranteed to attach a session cookie to it either.
 *
 * Auth model: this route is carved out as public in `proxy.ts` (alongside `/api/v1/health`) for
 * exactly that reason, and — since it can't check ANY credential on the inbound request — it
 * "treats itself as another trusted headless caller" (docs/API.md's own phrase) by calling
 * `captureLink` directly with the resolved single seeded user, the same privilege level a valid
 * `EXTENSION_TOKEN` bearer call would get. It does not literally re-POST to
 * `/api/v1/capture` over HTTP — that would be a same-process network round-trip for no benefit —
 * it calls the identical service function `POST /api/v1/capture`'s own route delegates to. See
 * this phase's final report for the full reasoning and the proxy.ts change this required.
 *
 * Response: a real HTTP redirect, not JSON — the browser is navigating, not fetching, so whatever
 * this returns is what the user sees next.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { logger } from '@/lib/logger'
import { captureLink } from '@/services/capture-service'
import { resolveSeededUserId } from '@/services/current-user'
import { resolveSharePayload } from '@/services/share'
import { SourceSurface } from '@/types/contracts'

function formValue(entry: FormDataEntryValue | null): string {
  return typeof entry === 'string' ? entry : ''
}

function confirmRedirect(request: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL('/capture/confirm', request.url)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  // 303: this POST must never be replayed by a back button / refresh on the confirmation page.
  return NextResponse.redirect(url, 303)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let form: FormData
  try {
    form = await request.formData()
  } catch (err) {
    logger.error({ err }, 'share: could not parse multipart form data')
    return confirmRedirect(request, { error: 'bad_request' })
  }

  const urlField = formValue(form.get('url'))
  const textField = formValue(form.get('text'))
  const titleField = formValue(form.get('title'))

  const resolved = resolveSharePayload(urlField, textField)
  if (!resolved) {
    return confirmRedirect(request, { error: 'no_url' })
  }

  try {
    const userId = resolveSeededUserId()
    const result = captureLink(userId, {
      url: resolved.url,
      ...(titleField ? { title: titleField } : {}),
      ...(resolved.note ? { note: resolved.note } : {}),
      surface: SourceSurface.Pwa,
    })
    return confirmRedirect(request, { id: result.id, duplicate: String(result.duplicate) })
  } catch (err) {
    logger.error({ err }, 'share: capture failed')
    return confirmRedirect(request, { error: 'failed' })
  }
}

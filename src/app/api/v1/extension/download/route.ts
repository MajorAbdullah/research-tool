/**
 * `GET /api/v1/extension/download` — the built browser extension as a ZIP.
 *
 * Exists so installing the extension never requires a checkout, a toolchain, or `make build-ext`.
 * That matters most once Sieve is on a VPS: the machine you install the extension on is not the
 * machine the source is on.
 *
 * The archive is built on demand rather than at image-build time. It is a handful of small files,
 * it is requested approximately twice in the life of an install, and building it on demand means
 * the download always matches whatever is actually deployed.
 *
 * Session-cookie auth only — not the extension bearer token, which is what this download is
 * needed to configure in the first place.
 */
import { NextResponse } from 'next/server'

import { findExtensionDist, zipDirectory } from '@/lib/extension-package'
import { requireSessionUserId } from '@/services/auth-context'
import { ApiError, errorResponse, generateRequestId } from '@/services/http'

export async function GET() {
  const requestId = generateRequestId()
  try {
    await requireSessionUserId()

    const dist = findExtensionDist()
    if (!dist) {
      // A clear, actionable message beats a 404: in dev this simply means it was never built.
      throw ApiError.notFound(
        'The extension has not been built. Run `make build-ext` (or `pnpm build:ext`) and reload.',
      )
    }

    const zip = zipDirectory(dist)
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="sieve-extension.zip"',
        'Content-Length': String(zip.length),
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}

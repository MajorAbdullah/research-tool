/**
 * Zod boundary validation for `POST /api/v1/capture` (docs/API.md §3.1) — kept separate from the
 * route so `tests/unit/api/**` can exercise validation edge cases without constructing a `Request`.
 */

import { z } from 'zod'
import { SourceSurface } from '@/types/contracts'
import type { SourceSurface as SourceSurfaceType } from '@/types/contracts'
import { isHttpUrl } from '@/services/url'

/**
 * docs/API.md §1.7: request body capped at 2 MB server-side (the extension caps itself at 1 MB
 * client-side with graceful truncation; the server enforces its own, independent, larger cap
 * rather than trusting the client to have truncated correctly).
 */
export const CAPTURE_BODY_CAP_BYTES = 2 * 1024 * 1024

const SOURCE_SURFACE_VALUES = Object.values(SourceSurface) as [
  SourceSurfaceType,
  ...SourceSurfaceType[],
]

export const CaptureRequestSchema = z
  .object({
    url: z.string().min(1, 'url is required'),
    title: z.string().optional(),
    note: z.string().optional(),
    html: z.string().optional(),
    transcript: z.string().optional(),
    caption: z.string().optional(),
    surface: z.enum(SOURCE_SURFACE_VALUES),
  })
  .superRefine((value, ctx) => {
    if (!isHttpUrl(value.url)) {
      ctx.addIssue({ code: 'custom', message: 'url must be an http(s) URL', path: ['url'] })
    }
  })

export type CaptureRequestBody = z.infer<typeof CaptureRequestSchema>

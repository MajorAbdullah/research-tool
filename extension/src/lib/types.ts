/**
 * Wire types for Sieve's HTTP API, as consumed by the extension.
 *
 * These are hand-mirrored from `docs/API.md` (§2 "Shared types" and §3.1
 * "POST /api/v1/capture"), NOT imported from the server's own source —
 * P4 (this extension) and the server routes are built by different agents
 * from opposite sides of that one document, deliberately without sharing
 * code (see docs/API.md's own header). Keep this file's shapes in sync with
 * docs/API.md by hand if the contract changes; do not "simplify" by trying
 * to import from `src/` (out of this phase's owned paths, and the whole
 * point of the split is that these two sides don't share a module graph).
 *
 * Only the subset of the full contract the extension actually sends or reads
 * is reproduced here — e.g. no `ItemSummary`/`Item` detail shape, since the
 * extension never reads items back.
 */

/**
 * docs/API.md §2: `SourceSurface = "extension" | "pwa" | "web" | "import"`.
 *
 * NOTE (see the "ambiguities" section of the build report / README): the
 * task brief for this phase asks for finer-grained values here, e.g.
 * `extension_toolbar` / `extension_context_menu`, so a UI could tell capture
 * paths apart. `docs/API.md` — the frozen contract both sides build against
 * — defines `SourceSurface` as this closed 4-value union with a single
 * `"extension"` value covering every extension-originated capture. Sending
 * anything outside this union risks `400 VALIDATION_ERROR` against a
 * Zod-validated server boundary (CLAUDE.md requires exactly that kind of
 * strict boundary validation). This file follows the frozen contract; the
 * finer-grained path is tracked client-side only (console logging + the
 * popup's own status text), never on the wire. See the README's
 * "Contract ambiguities" section for the suggested fix upstream.
 */
export type SourceSurface = 'extension' | 'pwa' | 'web' | 'import'

/** docs/API.md §3.1 request body. `url` and `surface` are the only required fields. */
export interface CaptureRequest {
  url: string
  title?: string
  note?: string
  html?: string
  transcript?: string
  caption?: string
  surface: SourceSurface
}

/** docs/API.md §3.1 response body (both the new-item and duplicate cases). */
export interface CaptureResponse {
  id: string
  status: string
  duplicate: boolean
}

/** docs/API.md §1.5 — the one error shape used by every endpoint. */
export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details: unknown
    request_id: string
  }
}

/** docs/API.md §3.11 — only the top-level field the options page's "Test connection" button needs. */
export interface HealthResponse {
  status: string
}

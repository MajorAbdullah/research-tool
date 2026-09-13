import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIST = join(process.cwd(), 'extension', 'dist')
const built = existsSync(join(DIST, 'manifest.json'))

/**
 * Regression: the manifest pointed at `popup.html` / `options.html` at the extension root, but
 * Vite emits them under `src/popup/` and `src/options/`. Chrome rejects an extension whose
 * manifest references a file that isn't there — and nothing else in the build would have caught
 * it, because both halves succeed independently.
 *
 * Skipped when extension/dist is absent, so `pnpm test` still passes on a fresh clone.
 */
describe.skipIf(!built)('extension manifest', () => {
  const manifest = built
    ? (JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8')) as Record<string, never>)
    : ({} as Record<string, never>)

  function referencedPaths(m: Record<string, unknown>): string[] {
    const out: string[] = []
    const action = m.action as { default_popup?: string } | undefined
    if (action?.default_popup) out.push(action.default_popup)
    if (typeof m.options_page === 'string') out.push(m.options_page)
    const ui = m.options_ui as { page?: string } | undefined
    if (ui?.page) out.push(ui.page)
    const bg = m.background as { service_worker?: string } | undefined
    if (bg?.service_worker) out.push(bg.service_worker)
    for (const p of Object.values((m.icons as Record<string, string>) ?? {})) out.push(p)
    for (const cs of (m.content_scripts as Array<{ js?: string[]; css?: string[] }>) ?? []) {
      out.push(...(cs.js ?? []), ...(cs.css ?? []))
    }
    return out
  }

  it('references only files that exist in dist', () => {
    const missing = referencedPaths(manifest).filter((p) => !existsSync(join(DIST, p)))
    expect(missing, `manifest points at files that were not built: ${missing.join(', ')}`).toEqual(
      [],
    )
  })

  it('keeps the two load-bearing script filenames unhashed', () => {
    // manifest.background.service_worker and executeScript({files}) reference these by exact
    // name, so a content hash here silently breaks the extension at runtime.
    expect(existsSync(join(DIST, 'background.js'))).toBe(true)
    expect(existsSync(join(DIST, 'content-main.js'))).toBe(true)
  })
})

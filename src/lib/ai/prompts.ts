/**
 * Loader for `prompts/**` — versioned prompt files, one per task, never inline strings
 * (CLAUDE.md/genai-best-practices: "Prompts are versioned files in prompts/"). The version
 * embedded in the filename (`enrichment.v1.md` -> `v1`) is what gets logged to `llm_calls` next to
 * the resolved model, so a prompt change and a model change are each independently visible in the
 * log rather than looking like the same "something changed" event.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export interface LoadedPrompt {
  /** e.g. 'v1', parsed from the filename — never hand-written separately from it, so the two
   *  can't drift. */
  version: string
  content: string
}

/**
 * Resolved from process.cwd(), NOT from import.meta.url.
 *
 * `new URL('../../../prompts/', import.meta.url)` works under vitest and tsx — which is why 577
 * tests passed with it — but breaks `next build`: the bundler cannot trace a runtime filesystem
 * path relative to a module URL, and the emitted chunk no longer sits three directories below the
 * repo root. next.config.ts's `outputFileTracingIncludes` copies prompts/** into the standalone
 * output, where cwd is the standalone root, so cwd-relative resolution holds in dev, in tests and
 * in production.
 *
 * Candidates are tried in order so a monorepo-style cwd or a standalone layout both work, and an
 * unresolvable prompt names every path it tried instead of failing with a bare ENOENT.
 */
const PROMPT_DIR_CANDIDATES = [
  path.join(process.cwd(), 'prompts'),
  // standalone output nests the app under .next/standalone/
  path.join(process.cwd(), '..', '..', 'prompts'),
]

function resolvePromptPath(filename: string): string {
  for (const dir of PROMPT_DIR_CANDIDATES) {
    const candidate = path.join(dir, filename)
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    `Prompt '${filename}' not found. Looked in: ${PROMPT_DIR_CANDIDATES.join(', ')}. ` +
      `If this is a production build, check next.config.ts's outputFileTracingIncludes.`,
  )
}

const VERSIONED_FILENAME = /\.v(\d+)\.[a-z0-9]+$/i

const cache = new Map<string, LoadedPrompt>()

/**
 * `filename` is relative to `prompts/`, e.g. `'enrichment.v1.md'`. Cached after first read since
 * prompt files don't change while the process is running; call `clearPromptCache()` in tests that
 * need to observe a rewritten fixture file.
 */
export function loadPrompt(filename: string): LoadedPrompt {
  const cached = cache.get(filename)
  if (cached) return cached

  const match = VERSIONED_FILENAME.exec(filename)
  if (!match || !match[1]) {
    throw new Error(
      `Prompt filename '${filename}' must be versioned as '<task>.v<N>.<ext>' (e.g. ` +
        `'enrichment.v1.md') — see CLAUDE.md's Gen-AI section.`,
    )
  }
  const content = readFileSync(resolvePromptPath(filename), 'utf8').trim()
  const loaded: LoadedPrompt = { version: `v${match[1]}`, content }
  cache.set(filename, loaded)
  return loaded
}

export function clearPromptCache(): void {
  cache.clear()
}

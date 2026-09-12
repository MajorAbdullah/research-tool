/**
 * Loader for `prompts/**` — versioned prompt files, one per task, never inline strings
 * (CLAUDE.md/genai-best-practices: "Prompts are versioned files in prompts/"). The version
 * embedded in the filename (`enrichment.v1.md` -> `v1`) is what gets logged to `llm_calls` next to
 * the resolved model, so a prompt change and a model change are each independently visible in the
 * log rather than looking like the same "something changed" event.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export interface LoadedPrompt {
  /** e.g. 'v1', parsed from the filename — never hand-written separately from it, so the two
   *  can't drift. */
  version: string
  content: string
}

// This file lives at src/lib/ai/prompts.ts; the repo root (and therefore prompts/) is three
// directories up.
const PROMPTS_DIR = fileURLToPath(new URL('../../../prompts/', import.meta.url))

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
  const content = readFileSync(path.join(PROMPTS_DIR, filename), 'utf8').trim()
  const loaded: LoadedPrompt = { version: `v${match[1]}`, content }
  cache.set(filename, loaded)
  return loaded
}

export function clearPromptCache(): void {
  cache.clear()
}

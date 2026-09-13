import { defineConfig } from 'vite'
import { resolve } from 'node:path'

const root = __dirname

/**
 * Builds ONE self-contained IIFE script per invocation — see vite.pages.config.ts for why the
 * extension's pages and its scripts are built separately at all.
 *
 * Why one entry per pass rather than two in a single `input` map: Rollup rejects
 * `output.format: 'iife'` whenever a build has more than one entry ("UMD and IIFE output formats
 * are not supported for code-splitting builds"). That is the same constraint the original comment
 * was reaching for — each script must be a single self-contained file with no shared chunks —
 * it just cannot be expressed as a two-entry build. So package.json runs this config twice with
 * a different SIEVE_ENTRY.
 *
 * Both filenames are load-bearing and must never be content-hashed:
 *   background.js    — manifest.json's `background.service_worker`
 *   content-main.js  — the `files:` array in chrome.scripting.executeScript()
 */

const ENTRIES = {
  background: 'src/background/service-worker.ts',
  'content-main': 'src/content/content-main.ts',
} as const

type EntryName = keyof typeof ENTRIES

export default defineConfig(() => {
  const name = process.env.SIEVE_ENTRY as EntryName | undefined
  if (!name || !(name in ENTRIES)) {
    throw new Error(
      `SIEVE_ENTRY must be one of: ${Object.keys(ENTRIES).join(', ')} — got ${String(name)}`,
    )
  }

  return {
    root,
    // publicDir is copied once, by the pages pass. Copying it again here would be wasted work,
    // and emptyOutDir must stay false or this pass would delete the pages output.
    publicDir: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        input: { [name]: resolve(root, ENTRIES[name]) },
        output: {
          format: 'iife' as const,
          entryFileNames: '[name].js',
          // Required for IIFE: fold everything into the single output file.
          inlineDynamicImports: true,
        },
      },
    },
  }
})

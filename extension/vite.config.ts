import { defineConfig } from 'vite'
import { resolve } from 'node:path'

const root = __dirname

/**
 * Why two build passes instead of one Vite input map:
 *
 * `popup.html` / `options.html` are normal extension *pages* — Vite's usual
 * ES-module output (code-split, content-hashed chunks) is exactly right for
 * them, the same as any small web app.
 *
 * `background.js` (the MV3 service worker) and `content-main.js` (injected
 * on demand via `chrome.scripting.executeScript({ files: [...] })`, see
 * src/background/service-worker.ts) are different:
 *   - Their filenames are load-bearing — manifest.json's
 *     `background.service_worker` and the `files:` array in executeScript()
 *     reference them by exact, stable name, so they cannot be content-hashed.
 *   - They must each be a single self-contained script. `executeScript`'s
 *     `files` option does not reliably support ES-module chunk graphs across
 *     Chrome versions the way a `<script type="module">` page does, so these
 *     two entries are built as IIFE bundles instead — no shared chunks, a
 *     little code duplication between the two files if they both import the
 *     same helper, which is fine (they run in separate JS contexts and could
 *     never share a module instance anyway).
 *
 * Vite supports exporting an array of configs from one config file — each
 * one runs as its own build pass when you run `vite build` once.
 */
const pagesConfig = defineConfig({
  root,
  publicDir: resolve(root, 'public'),
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(root, 'src/popup/popup.html'),
        options: resolve(root, 'src/options/options.html'),
      },
    },
  },
})

const scriptsConfig = defineConfig({
  root,
  // publicDir is only copied once — the pages pass above already did it, and
  // wiping dist/ again here (emptyOutDir) would delete popup/options output.
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        background: resolve(root, 'src/background/service-worker.ts'),
        'content-main': resolve(root, 'src/content/content-main.ts'),
      },
      output: {
        format: 'iife',
        entryFileNames: '[name].js',
        // IIFE bundles must not be split into shared chunks; each entry
        // brings its own copy of any shared helper it imports.
        inlineDynamicImports: false,
      },
    },
  },
})

export default defineConfig([pagesConfig, scriptsConfig])

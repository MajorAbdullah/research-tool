/**
 * Local `EmbeddingProvider` — `fastembed` / `bge-small-en-v1.5`, 384 dims, ONNX-quantized (ADR
 * 0003, P3.3.1). Zero OpenRouter requests per embed; this is what makes both ingest and search
 * free against the daily budget.
 *
 * Measured against the installed package (not estimated): ~350 MB resident once the model loads
 * (350 MB, not the ~120 MB originally guessed — see ADR 0003's correction), warm init from the
 * on-disk cache is ~0.25s, throughput ~87ms/chunk. Those numbers are exactly why this module is
 * built the way it is:
 *
 * - **Process-wide singleton, memoized on `globalThis`.** `FlagEmbedding.init()` is cheap warm,
 *   but each instance is ~350 MB resident that GC cannot reclaim (it's native onnxruntime arena,
 *   not the JS heap). Next.js dev's hot-reload re-evaluates this module on every edit; without a
 *   `globalThis` anchor that would construct a fresh provider (and a fresh 350 MB model load) per
 *   reload, compounding fast. This is the single most important robustness detail here.
 * - **Lazy, dynamic `import('fastembed')`** — not a static top-level import. `fastembed`
 *   transitively requires `onnxruntime-node`, a native module that may not always be present
 *   (verified during this phase: it was mid-download at one point). A dynamic import means this
 *   file can be imported and typechecked regardless, and only fails — loudly, not silently — when
 *   something actually tries to embed.
 * - **Concurrency capped at 2** (`Semaphore`), shared by both `embed()` and `embedQuery()` — this
 *   box shares 6 vCPUs with ~45 other containers.
 */

import type { EmbeddingProvider } from '@/types/contracts'
import { Semaphore } from './concurrency'

export const LOCAL_EMBEDDING_MODEL_ID = 'bge-small-en-v1.5'
export const LOCAL_EMBEDDING_DIMENSIONS = 384

const DEFAULT_CACHE_DIR = './.fastembed_cache'
const DEFAULT_CONCURRENCY = 2
const DEFAULT_BATCH_SIZE = 256

/** The exact slice of `fastembed`'s `FlagEmbedding` this module uses — declared locally so
 *  nothing here needs a static import of the real package (see the lazy-import note above). */
export interface FastEmbedModel {
  passageEmbed(texts: string[], batchSize?: number): AsyncGenerator<number[][], void, unknown>
  queryEmbed(text: string): Promise<number[]>
}

export interface LocalEmbeddingProviderOptions {
  cacheDir?: string
  concurrency?: number
  batchSize?: number
  /** Injection point for tests — bypasses the real `fastembed`/`onnxruntime-node` import
   *  entirely, so unit tests never touch the network or load a 350 MB model. */
  loadModel?: () => Promise<FastEmbedModel>
}

async function defaultLoadModel(cacheDir: string): Promise<FastEmbedModel> {
  // Best-effort ONNX CPU-thread cap. Verified against the installed `fastembed` package:
  // `FlagEmbedding.init()` forwards only `executionProviders` to `ort.InferenceSession.create()` —
  // there is no session-level `intraOpNumThreads` passthrough in its public API. Short of forking
  // fastembed, the only remaining lever is the OpenMP env var onnxruntime's native CPU execution
  // provider reads at session-creation time, so it must be set before `onnxruntime-node` is first
  // imported (transitively, by importing `fastembed` here).
  if (!process.env.OMP_NUM_THREADS) {
    process.env.OMP_NUM_THREADS = String(DEFAULT_CONCURRENCY)
  }
  const { FlagEmbedding, EmbeddingModel, ExecutionProvider } = await import('fastembed')
  return FlagEmbedding.init({
    model: EmbeddingModel.BGESmallENV15,
    executionProviders: [ExecutionProvider.CPU],
    maxLength: 512,
    cacheDir,
    showDownloadProgress: false,
  })
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly model = LOCAL_EMBEDDING_MODEL_ID
  readonly dimensions = LOCAL_EMBEDDING_DIMENSIONS

  private readonly semaphore: Semaphore
  private readonly batchSize: number
  private readonly loadModelImpl: () => Promise<FastEmbedModel>
  private modelPromise: Promise<FastEmbedModel> | undefined

  constructor(options: LocalEmbeddingProviderOptions = {}) {
    this.semaphore = new Semaphore(options.concurrency ?? DEFAULT_CONCURRENCY)
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
    const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR
    this.loadModelImpl = options.loadModel ?? (() => defaultLoadModel(cacheDir))
  }

  /** Warm the model once, at boot — not per call (P3.3.2). Safe to call more than once; the
   *  underlying init only ever runs a single time (memoized). */
  async warmUp(): Promise<void> {
    await this.getModel()
  }

  private getModel(): Promise<FastEmbedModel> {
    if (!this.modelPromise) {
      this.modelPromise = this.loadModelImpl().catch((err: unknown) => {
        // Don't cache a failed load forever — a transient error (e.g. a cold cache dir hiccup)
        // shouldn't permanently wedge the provider; the next call gets to try again.
        this.modelPromise = undefined
        throw err
      })
    }
    return this.modelPromise
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    return this.semaphore.run(async () => {
      const model = await this.getModel()
      const out: number[][] = []
      // One call into fastembed for the whole array — fastembed does its own internal batching
      // at `batchSize`, so a 20-chunk item is still exactly one `passageEmbed()` invocation here.
      for await (const batch of model.passageEmbed(texts, this.batchSize)) {
        // `Array.from()`, not a spread/push of the raw values: verified against the installed
        // package that fastembed actually yields `Float32Array` vectors at runtime despite its
        // own `.d.ts` claiming `number[]` — a real, silent mismatch caught by a live smoke test
        // of `pnpm reembed`, not by the mocked unit suite. `JSON.stringify()` on a `Float32Array`
        // serializes as `{"0":...,"1":...}`, not `[...]`, which sqlite-vec's `chunk_vec` insert
        // rejects outright. `EmbeddingProvider.embed()` is frozen as `Promise<number[][]>` — this
        // is where that promise actually gets kept, once, rather than trusting every downstream
        // caller (search, `reembed.ts`, topic-assignment cosine math) to defend against it.
        for (const vector of batch) out.push(Array.from(vector))
      }
      return out
    })
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.semaphore.run(async () => {
      const model = await this.getModel()
      const vector = await model.queryEmbed(text)
      return Array.from(vector)
    })
  }
}

const GLOBAL_SINGLETON_KEY = Symbol.for('sieve.embeddings.localProvider')

interface GlobalWithSingleton {
  [GLOBAL_SINGLETON_KEY]?: LocalEmbeddingProvider
}

/**
 * Process-wide singleton, memoized on `globalThis` — see this file's header comment for why a
 * plain module-scope variable isn't enough under Next.js dev's hot-reload.
 */
export function getLocalEmbeddingProvider(
  options?: LocalEmbeddingProviderOptions,
): LocalEmbeddingProvider {
  const g = globalThis as GlobalWithSingleton
  if (!g[GLOBAL_SINGLETON_KEY]) {
    g[GLOBAL_SINGLETON_KEY] = new LocalEmbeddingProvider(options)
  }
  return g[GLOBAL_SINGLETON_KEY]
}

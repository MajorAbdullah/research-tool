/**
 * Download and cache the local embedding model, then prove it works.
 *
 *   pnpm warm:model      (or: make model-warm)
 *
 * WHY: bge-small-en-v1.5 is a ~128 MB download on first use. Without warming it,
 * the very first captured link pays that cost inside a pipeline job — which looks
 * like a hung or broken ingest rather than a one-time download. Measured: ~480 s
 * cold (download) vs ~0.25 s warm from the on-disk cache.
 *
 * Safe to re-run: if the cache is already populated this is a no-op plus one
 * embedding call, and prints the warm timing instead.
 */
import { getLocalEmbeddingProvider } from '@/lib/embeddings'

async function main() {
  const started = Date.now()
  const provider = await getLocalEmbeddingProvider()
  const initMs = Date.now() - started

  // Actually embed something — loading the model without running it would not
  // surface a corrupt or partial download.
  const embedStarted = Date.now()
  const [vector] = await provider.embed(['warm the local embedding model'])
  const embedMs = Date.now() - embedStarted

  if (!vector || vector.length !== provider.dimensions) {
    throw new Error(
      `Expected a ${provider.dimensions}-dim vector, got ${vector ? vector.length : 'nothing'}. ` +
        `The model cache may be corrupt — delete .fastembed_cache and re-run.`,
    )
  }

  console.log(`model      : ${provider.model}`)
  console.log(`dimensions : ${provider.dimensions}`)
  console.log(
    `init       : ${(initMs / 1000).toFixed(2)}s ${initMs > 30_000 ? '(cold — downloaded)' : '(warm — cached)'}`,
  )
  console.log(`embed      : ${embedMs}ms`)
  console.log('cache ready.')
}

main().catch((error: unknown) => {
  console.error('warm-model failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})

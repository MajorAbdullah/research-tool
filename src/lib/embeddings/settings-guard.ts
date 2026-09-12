/**
 * Model-mismatch guard (P3.3.3, ADR 0003): refuses to proceed when the embedding model this
 * process is configured to use doesn't match what's already recorded in `settings.embedding_model`
 * from a previous run. Vectors from different models are not comparable — this must fail loudly
 * at startup, never silently re-embed with the wrong model or silently keep writing chunks that
 * would corrupt the index against the ones already there.
 */

import type { SettingsPort } from '@/lib/ai/settings-store'

export const EMBEDDING_MODEL_SETTINGS_KEY = 'embedding_model'

export class EmbeddingModelMismatchError extends Error {
  readonly configuredModel: string
  readonly storedModel: string

  constructor(configuredModel: string, storedModel: string) {
    super(
      `Configured embedding model '${configuredModel}' does not match settings.embedding_model ` +
        `('${storedModel}'). Vectors from different models aren't comparable — run 'pnpm reembed' ` +
        'to switch deliberately; this is never done as a silent fallback.',
    )
    this.name = 'EmbeddingModelMismatchError'
    this.configuredModel = configuredModel
    this.storedModel = storedModel
  }
}

/**
 * Call once at boot with whichever `EmbeddingProvider.model` this process is about to use. First
 * boot ever (no stored value yet) just records it — there is nothing to mismatch against yet.
 * Every subsequent boot must match exactly, or this throws.
 */
export function assertEmbeddingModelMatches(configuredModel: string, store: SettingsPort): void {
  const stored = store.get(EMBEDDING_MODEL_SETTINGS_KEY)
  if (stored === undefined) {
    store.set(EMBEDDING_MODEL_SETTINGS_KEY, configuredModel)
    return
  }
  if (stored !== configuredModel) {
    throw new EmbeddingModelMismatchError(configuredModel, stored)
  }
}

/** Used by `reembed.ts` after a deliberate model swap: overwrite the recorded model instead of
 *  asserting against it. The only legitimate way `settings.embedding_model` should ever change. */
export function recordEmbeddingModel(model: string, store: SettingsPort): void {
  store.set(EMBEDDING_MODEL_SETTINGS_KEY, model)
}

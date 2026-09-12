/**
 * Selects which `EmbeddingProvider` implementation backs the app, from `EMBEDDING_PROVIDER`
 * (`.env.example`: `local` default, `openrouter` the documented non-default alternative — P3.3.6).
 * `local` needs nothing further; `openrouter` requires its own explicit options (an API key and,
 * critically, the model's real dimension — see `openrouter-provider.ts` for why there's no safe
 * default for that) supplied by the caller rather than guessed here, since enabling it is meant to
 * be a deliberate choice, not a drop-in env toggle.
 */

import type { EmbeddingProvider } from '@/types/contracts'
import { getLocalEmbeddingProvider, type LocalEmbeddingProviderOptions } from './local-provider'
import { OpenRouterEmbeddingProvider, type OpenRouterEmbeddingProviderOptions } from './openrouter-provider'

export type EmbeddingProviderKind = 'local' | 'openrouter'

/**
 * Reads only `EMBEDDING_PROVIDER` — anything other than the literal `'openrouter'` is treated as
 * `'local'`, matching `.env.example`'s documented default.
 *
 * Typed as a plain string-keyed dictionary rather than `NodeJS.ProcessEnv` on purpose: this
 * function only ever reads one key, so depending on Node's full process-env type (which pulls in
 * unrelated required fields depending on `@types/node`'s version) would be needless coupling for
 * both callers and tests supplying a fixture env.
 */
export function selectEmbeddingProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): EmbeddingProviderKind {
  return env.EMBEDDING_PROVIDER === 'openrouter' ? 'openrouter' : 'local'
}

export interface EmbeddingProviderSelection {
  provider: EmbeddingProviderKind
  local?: LocalEmbeddingProviderOptions
  openRouter?: OpenRouterEmbeddingProviderOptions
}

export function createEmbeddingProvider(selection: EmbeddingProviderSelection): EmbeddingProvider {
  if (selection.provider === 'local') {
    return getLocalEmbeddingProvider(selection.local)
  }
  if (!selection.openRouter) {
    throw new Error(
      "EMBEDDING_PROVIDER=openrouter requires OpenRouterEmbeddingProviderOptions (apiKey + " +
        'dimensions) to be supplied explicitly in code — there is no safe default dimension to ' +
        'assume for a hosted embedding model. This path is a deliberate opt-in, not a drop-in env ' +
        'toggle; see openrouter-provider.ts and .env.example’s EMBEDDING_PROVIDER documentation.',
    )
  }
  return new OpenRouterEmbeddingProvider(selection.openRouter)
}

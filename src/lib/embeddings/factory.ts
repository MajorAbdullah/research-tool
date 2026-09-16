/**
 * Selects which `EmbeddingProvider` implementation backs the app, from `EMBEDDING_PROVIDER`
 * (`.env.example`: `local` default, `openrouter` the documented non-default alternative — P3.3.6).
 * `local` needs nothing further; `openrouter` requires its own explicit options (an API key and,
 * critically, the model's real dimension — see `openrouter-provider.ts` for why there's no safe
 * default for that) supplied by the caller rather than guessed here, since enabling it is meant to
 * be a deliberate choice, not a drop-in env toggle.
 */

import type { EmbeddingProvider } from '@/types/contracts'
import { getConfig, type AppConfig } from '@/lib/config'
import type { BudgetLane, BudgetManager } from '@/lib/ai/budget'
import { BudgetedEmbeddingProvider } from './budgeted-provider'
import { getLocalEmbeddingProvider, type LocalEmbeddingProviderOptions } from './local-provider'
import {
  OpenRouterEmbeddingProvider,
  type OpenRouterEmbeddingProviderOptions,
} from './openrouter-provider'

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
      'EMBEDDING_PROVIDER=openrouter requires OpenRouterEmbeddingProviderOptions (apiKey + ' +
        'dimensions) to be supplied explicitly in code — there is no safe default dimension to ' +
        'assume for a hosted embedding model. This path is a deliberate opt-in, not a drop-in env ' +
        'toggle; see openrouter-provider.ts and .env.example’s EMBEDDING_PROVIDER documentation.',
    )
  }
  return new OpenRouterEmbeddingProvider(selection.openRouter)
}

/**
 * The one supported way to build the app's embedding provider: everything comes from validated
 * config, so `chunk_vec`'s column width, the search path and `pnpm reembed` all read the same
 * numbers. Use this rather than `createEmbeddingProvider` anywhere that runs in the real app.
 *
 * `createEmbeddingProvider` above still takes explicit options because tests and one-off scripts
 * legitimately need to construct a provider without a full environment.
 *
 * Note what this does NOT do: fall back to the other provider when one is unavailable. Vectors
 * from different models aren't comparable, so a fallback would silently corrupt the index — the
 * rule from ADR 0003 that survives every other change here.
 */
export interface EmbeddingProviderFromConfigOptions {
  config?: AppConfig
  /**
   * Supply both to meter a HOSTED provider against the shared free-tier budget. Omitted for the
   * local provider, which spends no requests, and omitted in tests/scripts that have no budget.
   * Without it a hosted provider still works — it just isn't counted, which is only correct where
   * nothing else is counting either.
   */
  budget?: BudgetManager
  /** `background` for ingest/re-embed; `interactive` for a query a user is waiting on. */
  lane?: BudgetLane
}

export function createEmbeddingProviderFromConfig(
  options: EmbeddingProviderFromConfigOptions = {},
): EmbeddingProvider {
  const config = options.config ?? getConfig()

  if (config.embeddingProvider !== 'openrouter') {
    // Local: no network, no quota, nothing to meter.
    return createEmbeddingProvider({ provider: 'local' })
  }

  const provider = createEmbeddingProvider({
    provider: 'openrouter',
    openRouter: {
      apiKey: config.openRouterApiKey,
      model: config.embeddingModel,
      dimensions: config.embeddingDimensions,
    },
  })

  if (!options.budget) return provider
  return new BudgetedEmbeddingProvider(provider, options.budget, options.lane ?? 'background')
}

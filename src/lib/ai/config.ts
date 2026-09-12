/**
 * Env parsing for the AI provider layer only. P1 owns the whole-app config loader
 * (`src/lib/config.ts`, P1.2.6) — this file deliberately does NOT reach into that path (it
 * doesn't exist yet in this phase's worktree, and cross-phase file edits aren't how P0's
 * parallelization works, see CLAUDE.md's "How to Work in This Repo"). Instead every P3 module
 * takes its config as an explicit constructor/function argument (dependency inversion), and this
 * file is the one place that knows how to build that argument from `process.env`. Whoever wires
 * the real app together (P1/P7) can call `loadAiConfig()` once at boot; tests call it with a
 * fixture env object instead of touching real process.env.
 */

export interface AiConfig {
  openRouterApiKey: string
  /** Ordered model ids, position 0 tried first. Never hardcoded — see CLAUDE.md non-negotiables. */
  chainEnrich: string[]
  chainChat: string[]
  dailyCap: number
  interactiveReserve: number
}

/** Under OpenRouter's global 20 req/min ceiling — see ADR 0004. Not an env var: there's no real
 *  reason to want a pace other than "just under the platform's own limit," per .env.example. */
export const RATE_LIMIT_PER_MINUTE = 18

const DEFAULT_DAILY_CAP = 900
const DEFAULT_INTERACTIVE_RESERVE = 100

function parseChain(raw: string | undefined, varName: string): string[] {
  const models = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (models.length === 0) {
    throw new Error(
      `${varName} must list at least one OpenRouter model id (comma-separated). See .env.example.`,
    )
  }
  return models
}

function parsePositiveInt(raw: string | undefined, varName: string, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${varName} must be a positive integer, got ${JSON.stringify(raw)}`)
  }
  return n
}

/**
 * Reads and validates the AI-layer env vars. Throws a readable error immediately on a missing
 * `OPENROUTER_API_KEY` or an empty chain, rather than letting the app come up half-broken (same
 * "fail fast at boot" principle as P1.2.6, scoped to this module's own env surface).
 *
 * Typed as a plain string-keyed dictionary rather than `NodeJS.ProcessEnv`: this only ever reads a
 * handful of specific keys, so a fixture env (in tests, or a future caller) shouldn't have to
 * satisfy Node's full process-env shape just to call it.
 */
export function loadAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const openRouterApiKey = env.OPENROUTER_API_KEY?.trim()
  if (!openRouterApiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is required (see .env.example: get one at https://openrouter.ai/keys)',
    )
  }
  const chainEnrich = parseChain(env.LLM_CHAIN_ENRICH, 'LLM_CHAIN_ENRICH')
  const chainChat = parseChain(env.LLM_CHAIN_CHAT, 'LLM_CHAIN_CHAT')
  const dailyCap = parsePositiveInt(env.LLM_DAILY_CAP, 'LLM_DAILY_CAP', DEFAULT_DAILY_CAP)
  const interactiveReserve = parsePositiveInt(
    env.LLM_INTERACTIVE_RESERVE,
    'LLM_INTERACTIVE_RESERVE',
    DEFAULT_INTERACTIVE_RESERVE,
  )
  if (interactiveReserve >= dailyCap) {
    throw new Error(
      `LLM_INTERACTIVE_RESERVE (${interactiveReserve}) must be less than LLM_DAILY_CAP (${dailyCap})`,
    )
  }
  return { openRouterApiKey, chainEnrich, chainChat, dailyCap, interactiveReserve }
}

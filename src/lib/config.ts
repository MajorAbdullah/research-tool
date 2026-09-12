/**
 * Zod-validated environment configuration — the single place `process.env` is read in this
 * codebase. Every other module imports typed config from here instead of touching
 * `process.env` directly, so there is exactly one source of truth for what variables exist,
 * what they default to, and what "invalid" means for each of them.
 *
 * Fails fast: `getConfig()` (called once, early, from `instrumentation.ts`) throws a single
 * `ConfigError` listing every missing/invalid variable by its .env name — never a half-booted
 * app that falls over later on first use. See CLAUDE.md's Non-Negotiables and .env.example for
 * the authoritative list of variables and what each one is for.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// .env hydration
// ---------------------------------------------------------------------------

// Next.js loads `.env`/`.env.local` itself for the app server, but the standalone `tsx` entry
// points (`pnpm db:migrate`, `pnpm seed:user`, `pnpm reembed`) do not go through Next at all.
// Node's built-in loader covers both cases identically and is a documented no-op merge (it never
// overwrites a variable already present in `process.env`, so real container env vars always win
// over anything a stray `.env` file might contain). Missing file / already-loaded is expected and
// silently ignored — this is best-effort hydration, not the validation step.
try {
  process.loadEnvFile()
} catch {
  // No .env file on disk (e.g. a production container that injects env vars directly) — fine.
}

// ---------------------------------------------------------------------------
// Small reusable field parsers
// ---------------------------------------------------------------------------

/** `"true" | "false"` (case-insensitive) -> boolean; unset -> `defaultValue`. */
function booleanFromEnv(defaultValue: boolean) {
  return z
    .string()
    .optional()
    .transform((raw) => (raw === undefined || raw === '' ? defaultValue : raw.trim().toLowerCase() === 'true'))
}

/** Comma-separated model-id list -> non-empty `string[]`, trimmed, empty entries dropped. */
function commaSeparatedList(fieldName: string) {
  return z
    .string()
    .min(1, `${fieldName} is required`)
    .transform((raw) =>
      raw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    )
    .refine((entries) => entries.length > 0, `${fieldName} must contain at least one value`)
}

// ---------------------------------------------------------------------------
// Schema — keys are exactly the .env variable names, so a validation error's `path` is
// directly the name a human needs to go fix in their `.env`. See .env.example for the
// authoritative description of every one of these.
// ---------------------------------------------------------------------------

const EnvSchema = z
  .object({
    // --- Server ---
    APP_NAME: z.string().min(1).default('Sieve'),
    APP_URL: z.string().url('APP_URL must be a full URL, e.g. http://localhost:3060').default('http://localhost:3060'),
    PORT: z.coerce.number().int().positive().default(3060),

    // --- Database ---
    SQLITE_PATH: z.string().min(1).default('./data/sieve.db'),

    // --- Auth ---
    AUTH_SECRET: z
      .string()
      .min(16, 'AUTH_SECRET must be at least 16 characters — generate one with `openssl rand -base64 32`'),
    SEED_USER_EMAIL: z.string().email('SEED_USER_EMAIL must be a valid email address'),
    SEED_USER_PASSWORD: z.string().min(1, 'SEED_USER_PASSWORD is required'),
    EXTENSION_TOKEN: z
      .string()
      .min(16, 'EXTENSION_TOKEN must be at least 16 characters — generate one with `openssl rand -hex 32`'),

    // --- GitHub extraction (optional — falls back toward metadata_only without it) ---
    GITHUB_PAT: z.string().min(1).optional(),

    // --- LLM / OpenRouter ---
    OPENROUTER_API_KEY: z.string().min(1, 'OPENROUTER_API_KEY is required'),
    LLM_CHAIN_ENRICH: commaSeparatedList('LLM_CHAIN_ENRICH'),
    LLM_CHAIN_CHAT: commaSeparatedList('LLM_CHAIN_CHAT'),
    LLM_DAILY_CAP: z.coerce.number().int().positive().default(900),
    LLM_INTERACTIVE_RESERVE: z.coerce.number().int().nonnegative().default(100),

    // --- Embeddings ---
    EMBEDDING_PROVIDER: z.enum(['local', 'openrouter']).default('local'),

    // --- Worker ---
    WORKER_ENABLED: booleanFromEnv(true),
  })
  .refine((env) => env.LLM_INTERACTIVE_RESERVE <= env.LLM_DAILY_CAP, {
    message: 'LLM_INTERACTIVE_RESERVE must not exceed LLM_DAILY_CAP',
    path: ['LLM_INTERACTIVE_RESERVE'],
  })

type ParsedEnv = z.infer<typeof EnvSchema>

/**
 * The typed, camelCased config every module imports. Field names intentionally diverge from
 * `ParsedEnv`'s (which mirror .env var names) so call sites read as app config, not env-var
 * archaeology — the renaming happens once, here, in `toAppConfig`.
 */
export interface AppConfig {
  appName: string
  appUrl: string
  port: number

  sqlitePath: string

  authSecret: string
  seedUserEmail: string
  seedUserPassword: string
  extensionToken: string

  githubPat: string | undefined

  openRouterApiKey: string
  llmChainEnrich: string[]
  llmChainChat: string[]
  llmDailyCap: number
  llmInteractiveReserve: number

  embeddingProvider: 'local' | 'openrouter'

  workerEnabled: boolean
}

function toAppConfig(env: ParsedEnv): AppConfig {
  return {
    appName: env.APP_NAME,
    appUrl: env.APP_URL,
    port: env.PORT,

    sqlitePath: env.SQLITE_PATH,

    authSecret: env.AUTH_SECRET,
    seedUserEmail: env.SEED_USER_EMAIL,
    seedUserPassword: env.SEED_USER_PASSWORD,
    extensionToken: env.EXTENSION_TOKEN,

    githubPat: env.GITHUB_PAT,

    openRouterApiKey: env.OPENROUTER_API_KEY,
    llmChainEnrich: env.LLM_CHAIN_ENRICH,
    llmChainChat: env.LLM_CHAIN_CHAT,
    llmDailyCap: env.LLM_DAILY_CAP,
    llmInteractiveReserve: env.LLM_INTERACTIVE_RESERVE,

    embeddingProvider: env.EMBEDDING_PROVIDER,

    workerEnabled: env.WORKER_ENABLED,
  }
}

/** Thrown by `loadConfig`/`getConfig` when `.env` fails validation. Message lists every issue. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      return `  - ${path}: ${issue.message}`
    })
    .join('\n')
}

/**
 * Pure parse function — takes an explicit env object rather than always reaching for
 * `process.env`, so tests can exercise every valid/invalid combination without mutating real
 * process state or juggling module-cache resets. Production code should prefer `getConfig()`.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(env)
  if (!result.success) {
    throw new ConfigError(
      `Invalid environment configuration — see .env.example for the full variable list:\n${formatIssues(result.error)}`,
    )
  }
  return toAppConfig(result.data)
}

let cached: AppConfig | undefined

/**
 * The app-wide singleton. Cached after the first successful parse so repeated calls (every
 * route handler, the worker loop, etc.) don't re-validate `process.env` on every access.
 * Call this early (see `instrumentation.ts`) so a bad `.env` fails the process at boot, not on
 * the first request that happens to touch config.
 */
export function getConfig(): AppConfig {
  if (!cached) {
    cached = loadConfig()
  }
  return cached
}

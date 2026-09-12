/**
 * GitHub — REST API + PAT. Deliberately does NOT use `runLadder` (see ladder.ts): the GitHub API
 * is not blocked from a datacenter IP (ADR 0006 — "GitHub and PDF go straight through APIs/direct
 * fetch, since those aren't blocked"), so there is exactly one rung. It either succeeds (`full`)
 * or throws a typed `ExtractionError` — 404 for a missing/renamed/private repo, `rate_limited`
 * with the reset time for an exhausted token — for the caller (P7's extract job) to handle as a
 * real failure, not a silent downgrade. `hint` is accepted (the frozen `Extractor` interface
 * requires it) but unused: nothing about a GitHub repo needs client-side capture.
 */
import { ExtractionTier, ItemKind } from '@/types/contracts'
import type { ClientCapture, Extractor, ExtractedContent } from '@/types/contracts'
import { canonicalizeUrlSync } from './canonicalize'
import { ExtractionError } from './errors'
import { type HttpClient, type HttpResponse, createHttpClient } from './http'
import { capText } from './text'

const GITHUB_API_BASE = 'https://api.github.com'
const USER_AGENT = 'sieve-extractor/1.0 (+https://github.com/sieve)'
const REQUEST_TIMEOUT_MS = 8000

interface GithubLicense {
  spdx_id: string | null
  name: string | null
}

interface GithubRepoResponse {
  full_name: string
  description: string | null
  language: string | null
  stargazers_count: number
  license: GithubLicense | null
  pushed_at: string
  created_at: string
  topics?: string[]
  owner: { login: string; avatar_url: string }
}

interface GithubReadmeResponse {
  content: string
  encoding: string
}

export interface GithubExtractorDeps {
  http: HttpClient
  /** Defaults to `process.env.GITHUB_PAT`. Unauthenticated calls work too, at a lower rate limit. */
  token?: string
}

export class GithubExtractor implements Extractor {
  readonly kind = ItemKind.Github
  private readonly http: HttpClient
  private readonly token: string | undefined

  constructor(deps: Partial<GithubExtractorDeps> = {}) {
    this.http = deps.http ?? createHttpClient()
    this.token = deps.token ?? process.env['GITHUB_PAT']
  }

  matches(url: string): boolean {
    return parseOwnerRepo(url) !== null
  }

  async extract(url: string, _hint?: ClientCapture): Promise<ExtractedContent> {
    const parsedRepo = parseOwnerRepo(url)
    if (!parsedRepo) {
      throw new ExtractionError('unsupported_url', `Not a GitHub repository URL: ${url}`)
    }
    const { owner, repo } = parsedRepo

    const repoRes = await this.http.request(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
      headers: this.headers(),
      timeoutMs: REQUEST_TIMEOUT_MS,
    })
    this.assertOk(repoRes, owner, repo)
    const repoData = parseJson<GithubRepoResponse>(repoRes, owner, repo)

    // A missing README is common (and not every repo has one) — it must never fail the whole
    // extraction. GitHub is single-rung/always-`full`, so any failure here is swallowed and just
    // means less contentText, not a lower tier.
    const readmeText = await this.fetchReadmeText(owner, repo)

    const contentParts = [repoData.description ?? '', readmeText].filter((part) => part.length > 0)
    const contentText = capText(contentParts.join('\n\n') || `${owner}/${repo}`)
    const createdAtMs = Date.parse(repoData.created_at)
    const pushedAtMs = Date.parse(repoData.pushed_at)

    return {
      contentText,
      extractionTier: ExtractionTier.Full,
      title: repoData.full_name,
      author: repoData.owner.login,
      publishedAt: Number.isNaN(createdAtMs) ? undefined : createdAtMs,
      thumbnailUrl: repoData.owner.avatar_url,
      kindFields: {
        what_it_does: repoData.description,
        language: repoData.language,
        stars: repoData.stargazers_count,
        license: repoData.license?.spdx_id ?? repoData.license?.name ?? null,
        last_commit: Number.isNaN(pushedAtMs) ? null : pushedAtMs,
      },
      rawPayload: { repo: repoData, hasReadme: readmeText.length > 0 },
    }
  }

  private async fetchReadmeText(owner: string, repo: string): Promise<string> {
    try {
      const readmeRes = await this.http.request(`${GITHUB_API_BASE}/repos/${owner}/${repo}/readme`, {
        headers: this.headers(),
        timeoutMs: REQUEST_TIMEOUT_MS,
      })
      if (!readmeRes.ok) return ''
      const readmeData = parseJson<GithubReadmeResponse>(readmeRes, owner, repo)
      return Buffer.from(readmeData.content, 'base64').toString('utf-8')
    } catch {
      return ''
    }
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'user-agent': USER_AGENT,
      'x-github-api-version': '2022-11-28',
    }
    if (this.token) headers['authorization'] = `Bearer ${this.token}`
    return headers
  }

  private assertOk(res: HttpResponse, owner: string, repo: string): void {
    if (res.ok) return

    if (res.status === 404) {
      throw new ExtractionError('not_found', `GitHub repo not found: ${owner}/${repo}`, { retryable: false })
    }

    const remaining = res.headers['x-ratelimit-remaining']
    if ((res.status === 403 || res.status === 429) && remaining === '0') {
      const resetHeader = res.headers['x-ratelimit-reset']
      const resetAtMs = resetHeader ? Number(resetHeader) * 1000 : undefined
      const retryAfterMs = resetAtMs !== undefined ? Math.max(0, resetAtMs - Date.now()) : undefined
      throw new ExtractionError(
        'rate_limited',
        `GitHub API rate limit exceeded for ${owner}/${repo}` +
          (resetAtMs !== undefined ? ` (resets ${new Date(resetAtMs).toISOString()})` : ''),
        { retryable: true, retryAfterMs },
      )
    }

    throw new ExtractionError('network_error', `GitHub API returned ${res.status} for ${owner}/${repo}`)
  }
}

function parseJson<T>(res: HttpResponse, owner: string, repo: string): T {
  try {
    return JSON.parse(res.body.toString('utf-8')) as T
  } catch (err) {
    throw new ExtractionError(
      'network_error',
      `GitHub API returned malformed JSON for ${owner}/${repo}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

function parseOwnerRepo(url: string): { owner: string; repo: string } | null {
  let parsed: URL
  try {
    parsed = new URL(canonicalizeUrlSync(url))
  } catch {
    return null
  }
  if (parsed.hostname !== 'github.com') return null
  const segments = parsed.pathname.split('/').filter(Boolean)
  const owner = segments[0]
  const repo = segments[1]
  if (!owner || !repo) return null
  return { owner, repo }
}

/**
 * Barrel export for P2's extractors and shared extraction infrastructure. Pure re-exports only —
 * wiring a registry/dispatcher that picks an extractor for a URL is P7's job (job pipeline
 * orchestration), not this phase's; import the classes directly from here for that.
 */
export { canonicalizeUrl, canonicalizeUrlSync } from './canonicalize'
export type { CanonicalizeOptions } from './canonicalize'

export { classifyKind } from './classify'

export { ExtractionError } from './errors'
export type { ExtractionErrorCode, ExtractionErrorOptions } from './errors'

export { createHttpClient, DEFAULT_TIMEOUT_MS } from './http'
export type { CreateHttpClientOptions, HttpClient, HttpRequestOptions, HttpResponse } from './http'

export { consoleLadderLogger, runLadder } from './ladder'
export type { LadderLogger, Rung } from './ladder'

export { DomainRateLimiter, withRetry } from './rate-limit'
export type { DomainRateLimiterOptions, RetryOptions } from './rate-limit'

export { capText, MAX_CONTENT_CHARS } from './text'

export { ArticleExtractor } from './article'
export type { ArticleExtractorDeps } from './article'

export { GithubExtractor } from './github'
export type { GithubExtractorDeps } from './github'

export { InstagramExtractor } from './instagram'
export type { InstagramExtractorDeps } from './instagram'

export { PdfExtractor } from './pdf'
export type { PdfExtractorDeps } from './pdf'

export { XThreadsExtractor } from './x-threads'
export type { XThreadsExtractorDeps } from './x-threads'

export { YoutubeExtractor } from './youtube'
export type { YoutubeExtractorDeps } from './youtube'

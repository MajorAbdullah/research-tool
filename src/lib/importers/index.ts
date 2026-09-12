// Public surface of the WhatsApp backlog importer (P12). The route layer (outside
// this phase's scope) should only need this barrel, `WhatsAppImportService`, and the
// port interfaces from `./types` to wire the real DB/AI-backed implementations in.

export * from './types'
export { normalizeLine, splitLines } from './text'
export {
  normalizeYear,
  detectDateOrder,
  daysInMonth,
  buildTimestampMs,
  type RawTimestampComponents,
  type BuildTimestampResult,
} from './timestamp'
export { parseWhatsAppChat } from './chat-parser'
export { extractUrls } from './url-extract'
export { classifyLinkKind } from './kind'
export { canonicalizeUrlForDedupe, computeUrlHash, type UrlCanonicalizer } from './url-hash'
export {
  buildCandidates,
  dedupeCandidates,
  countByKind,
  emptyKindCounts,
  type DedupeResult,
} from './candidates'
export { isZipBuffer, readZipEntry, listZipEntryNames, ZipFormatError } from './zip'
export { extractChatText } from './source'
export { estimateEtaMs, formatDurationHuman, type EtaInput } from './eta'
export { InMemoryImportProgressStore } from './memory-store'
export {
  WhatsAppImportService,
  type WhatsAppImportServiceOptions,
  type IngestUploadInput,
  type BackfillTickResult,
  type BackfillTickOutcome,
} from './service'

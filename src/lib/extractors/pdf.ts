/**
 * PDF / arXiv. Like github.ts, this deliberately does NOT use `runLadder` (see ladder.ts):
 * per ADR 0006, direct PDF fetch is "never blocked", so there is exactly one rung per URL shape,
 * and it either succeeds (`full`) or throws a typed `ExtractionError` — "always full or a hard
 * failure". `hint` is unused: `ClientCapture` carries html/transcript/caption, none of which apply
 * to a PDF byte stream.
 *
 *   - `arxiv.org/abs/<id>`  -> arXiv's Atom abstract API (stable, unblocked, no PDF parsing needed).
 *   - anything else ending `.pdf` (including `arxiv.org/pdf/<id>`) -> fetch bytes + `pdf-parse`.
 *
 * The Atom XML is parsed with small, deliberately narrow regexes rather than a general XML
 * parser or jsdom-as-XML (jsdom's HTML parser mishandles self-closing non-HTML tags like Atom's
 * `<category/>`) — this only ever needs to read arXiv's own stable, known response shape, not
 * arbitrary XML.
 */
import { PDFParse } from 'pdf-parse'
import { ExtractionTier, ItemKind } from '@/types/contracts'
import type { ClientCapture, Extractor, ExtractedContent } from '@/types/contracts'
import { canonicalizeUrlSync } from './canonicalize'
import { ExtractionError } from './errors'
import { type HttpClient, createHttpClient } from './http'
import { capText } from './text'

const ARXIV_API_BASE = 'http://export.arxiv.org/api/query'
const ARXIV_TIMEOUT_MS = 8000
const PDF_FETCH_TIMEOUT_MS = 20_000
/** Safety cap — never buffer an unbounded response body in memory. */
const MAX_PDF_BYTES = 40 * 1024 * 1024

export interface PdfExtractorDeps {
  http: HttpClient
}

export class PdfExtractor implements Extractor {
  readonly kind = ItemKind.Pdf
  private readonly http: HttpClient

  constructor(deps: Partial<PdfExtractorDeps> = {}) {
    this.http = deps.http ?? createHttpClient()
  }

  matches(url: string): boolean {
    let parsed: URL
    try {
      parsed = new URL(canonicalizeUrlSync(url))
    } catch {
      return false
    }
    if (parsed.hostname === 'arxiv.org') return true
    return parsed.pathname.toLowerCase().endsWith('.pdf')
  }

  async extract(url: string, _hint?: ClientCapture): Promise<ExtractedContent> {
    const arxivId = parseArxivAbsId(url)
    if (arxivId) return this.extractArxivAbstract(arxivId, url)
    return this.extractPdfBytes(canonicalizeUrlSync(url))
  }

  private async extractArxivAbstract(arxivId: string, originalUrl: string): Promise<ExtractedContent> {
    let res
    try {
      res = await this.http.request(`${ARXIV_API_BASE}?id_list=${encodeURIComponent(arxivId)}`, {
        timeoutMs: ARXIV_TIMEOUT_MS,
      })
    } catch (err) {
      throw new ExtractionError('network_error', `arXiv API request failed for ${arxivId}: ${message(err)}`, {
        cause: err,
      })
    }
    if (!res.ok) {
      throw new ExtractionError('network_error', `arXiv API returned ${res.status} for ${arxivId}`)
    }

    const entry = parseArxivEntry(res.body.toString('utf-8'))
    if (!entry) {
      throw new ExtractionError('not_found', `No arXiv entry found for ${arxivId}`, { retryable: false })
    }

    const publishedAtMs = entry.published ? Date.parse(entry.published) : NaN

    return {
      contentText: capText(entry.summary),
      extractionTier: ExtractionTier.Full,
      title: entry.title,
      author: entry.authors.join(', ') || undefined,
      publishedAt: Number.isNaN(publishedAtMs) ? undefined : publishedAtMs,
      kindFields: { arxivId, categories: entry.categories },
      rawPayload: { arxivId, originalUrl },
    }
  }

  private async extractPdfBytes(url: string): Promise<ExtractedContent> {
    let res
    try {
      res = await this.http.request(url, { timeoutMs: PDF_FETCH_TIMEOUT_MS })
    } catch (err) {
      throw new ExtractionError('network_error', `Failed to fetch PDF at ${url}: ${message(err)}`, { cause: err })
    }
    if (!res.ok) {
      throw new ExtractionError(
        res.status === 404 ? 'not_found' : 'network_error',
        `Failed to fetch PDF at ${url}: HTTP ${res.status}`,
        { retryable: res.status !== 404 },
      )
    }
    if (res.body.byteLength > MAX_PDF_BYTES) {
      throw new ExtractionError('invalid_pdf', `PDF at ${url} exceeds the ${MAX_PDF_BYTES}-byte cap`, {
        retryable: false,
      })
    }

    const parser = new PDFParse({ data: res.body })
    try {
      // Deliberately sequential, not `Promise.all([parser.getInfo(), parser.getText()])`: pdf.js
      // hands the document's bytes across a (fake, in-process-worker) transport that transfers
      // them on first use. Two concurrent calls on the same `PDFParse` instance race to transfer
      // the same underlying buffer and the loser fails with "Cannot transfer object of
      // unsupported type" — reproduced directly against this exact fixture. One call at a time
      // on one parser instance is the actual constraint, not a stylistic preference.
      const info = await parser.getInfo()
      const text = await parser.getText()
      if (!text.text.trim()) {
        throw new ExtractionError('invalid_pdf', `PDF at ${url} contained no extractable text`, {
          retryable: false,
        })
      }

      const title = firstNonBlankString(info.info?.Title)
      const author = firstNonBlankString(info.info?.Author)
      const dates = info.getDateNode()
      const publishedAt = dates.CreationDate ? dates.CreationDate.getTime() : undefined

      return {
        contentText: capText(text.text),
        extractionTier: ExtractionTier.Full,
        title,
        author,
        publishedAt,
        kindFields: { pageCount: info.total },
        rawPayload: { title: title ?? null, author: author ?? null, pageCount: info.total },
      }
    } catch (err) {
      if (err instanceof ExtractionError) throw err
      throw new ExtractionError('invalid_pdf', `Failed to parse PDF at ${url}: ${message(err)}`, { cause: err })
    } finally {
      await parser.destroy()
    }
  }
}

function firstNonBlankString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function parseArxivAbsId(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(canonicalizeUrlSync(url))
  } catch {
    return null
  }
  if (parsed.hostname !== 'arxiv.org') return null
  const match = /^\/abs\/([\w.\-/]+)/.exec(parsed.pathname)
  return match?.[1] ?? null
}

interface ArxivEntry {
  title: string
  summary: string
  authors: string[]
  published?: string
  categories: string[]
}

function parseArxivEntry(xml: string): ArxivEntry | null {
  const entryMatch = /<entry>([\s\S]*?)<\/entry>/.exec(xml)
  if (!entryMatch) return null
  const entry = entryMatch[1] ?? ''

  const title = extractTag(entry, 'title')
  const summary = extractTag(entry, 'summary')
  if (!title || !summary) return null

  const published = extractTag(entry, 'published')
  const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)].map((match) =>
    decodeXmlEntities((match[1] ?? '').trim()),
  )
  const categories = [...entry.matchAll(/<category[^>]*\sterm="([^"]*)"/g)].map((match) => match[1] ?? '')

  return {
    title: decodeXmlEntities(title).replace(/\s+/g, ' ').trim(),
    summary: decodeXmlEntities(summary).replace(/\s+/g, ' ').trim(),
    authors,
    published,
    categories,
  }
}

function extractTag(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(xml)
  return match?.[1]?.trim()
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

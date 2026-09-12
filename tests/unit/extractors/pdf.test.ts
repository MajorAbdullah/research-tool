import { describe, expect, it } from 'vitest'
import { ExtractionTier } from '@/types/contracts'
import { ExtractionError } from '@/lib/extractors/errors'
import { PdfExtractor } from '@/lib/extractors/pdf'
import {
  createFakeHttpClient,
  fixtureBuffer,
  fixtureText,
  networkError,
  respondWith,
} from './helpers/fake-http'

const SAMPLE_PDF = fixtureBuffer('pdf/sample.pdf')
const ARXIV_ATTENTION = fixtureText('pdf/arxiv-attention-is-all-you-need.atom.xml')
const ARXIV_NOT_FOUND = fixtureText('pdf/arxiv-not-found.atom.xml')

const DIRECT_PDF_URL = 'https://example.com/papers/sample.pdf'
const ARXIV_ABS_URL = 'https://arxiv.org/abs/1706.03762'

describe('PdfExtractor', () => {
  it('matches direct .pdf URLs and any arxiv.org URL', () => {
    const extractor = new PdfExtractor()
    expect(extractor.matches(DIRECT_PDF_URL)).toBe(true)
    expect(extractor.matches('https://example.com/papers/REPORT.PDF')).toBe(true)
    expect(extractor.matches(ARXIV_ABS_URL)).toBe(true)
    expect(extractor.matches('https://arxiv.org/pdf/1706.03762')).toBe(true)
    expect(extractor.matches('https://example.com/not-a-pdf')).toBe(false)
  })

  it('extracts real text, title, author, and page count from a direct PDF fetch — always "full"', async () => {
    const extractor = new PdfExtractor({
      http: createFakeHttpClient([{ match: DIRECT_PDF_URL, outcomes: [respondWith(SAMPLE_PDF)] }]),
    })

    const result = await extractor.extract(DIRECT_PDF_URL)

    expect(result.extractionTier).toBe(ExtractionTier.Full)
    expect(result.title).toBe('The Sieve Extraction Ladder: A Fixture')
    expect(result.author).toBe('Sieve Test Fixtures')
    expect(result.kindFields).toEqual({ pageCount: 5 })
    expect(result.publishedAt).toBe(Date.parse('2026-01-15T12:00:00Z'))
    expect(result.contentText).toContain('PINEAPPLE-TELESCOPE-7719')
    expect(result.contentText).toContain('Star count for this test: 42.')
  })

  it('throws a not_found ExtractionError on a 404 fetching the PDF bytes', async () => {
    const extractor = new PdfExtractor({
      http: createFakeHttpClient([
        { match: DIRECT_PDF_URL, outcomes: [respondWith('', { status: 404 })] },
      ]),
    })

    await expect(extractor.extract(DIRECT_PDF_URL)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('throws an invalid_pdf ExtractionError when the bytes are not a valid PDF', async () => {
    const extractor = new PdfExtractor({
      http: createFakeHttpClient([
        { match: DIRECT_PDF_URL, outcomes: [respondWith('this is definitely not a pdf file')] },
      ]),
    })

    await expect(extractor.extract(DIRECT_PDF_URL)).rejects.toBeInstanceOf(ExtractionError)
    await expect(extractor.extract(DIRECT_PDF_URL)).rejects.toMatchObject({ code: 'invalid_pdf' })
  })

  it('throws a network_error ExtractionError when the fetch itself fails, never returning metadata_only', async () => {
    const extractor = new PdfExtractor({
      http: createFakeHttpClient([
        { match: DIRECT_PDF_URL, outcomes: [networkError('ECONNRESET')] },
      ]),
    })

    await expect(extractor.extract(DIRECT_PDF_URL)).rejects.toMatchObject({ code: 'network_error' })
  })

  it('extracts a real arXiv abstract via the API — always "full"', async () => {
    const extractor = new PdfExtractor({
      http: createFakeHttpClient([
        { match: 'id_list=1706.03762', outcomes: [respondWith(ARXIV_ATTENTION)] },
      ]),
    })

    const result = await extractor.extract(ARXIV_ABS_URL)

    expect(result.extractionTier).toBe(ExtractionTier.Full)
    expect(result.title).toBe('Attention Is All You Need')
    expect(result.author).toBe(
      'Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, ' +
        'Aidan N. Gomez, Lukasz Kaiser, Illia Polosukhin',
    )
    expect(result.publishedAt).toBe(Date.parse('2017-06-12T17:57:34Z'))
    expect(result.kindFields).toEqual({ arxivId: '1706.03762', categories: ['cs.CL', 'cs.LG'] })
    expect(result.contentText).toContain('the Transformer, based solely on attention mechanisms')
  })

  it('throws a not_found ExtractionError when arXiv returns an empty feed', async () => {
    const extractor = new PdfExtractor({
      http: createFakeHttpClient([
        { match: /id_list=9999\.99999/, outcomes: [respondWith(ARXIV_NOT_FOUND)] },
      ]),
    })

    await expect(extractor.extract('https://arxiv.org/abs/9999.99999')).rejects.toMatchObject({
      code: 'not_found',
      retryable: false,
    })
  })
})

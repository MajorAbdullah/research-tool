import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import {
  assembleTranscript,
  getSegmentElements,
  readSegment,
} from '../../src/content/youtube-transcript-assemble'

function loadFixture(name: string): Document {
  const html = readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf-8')
  return new JSDOM(html).window.document
}

describe('assembleTranscript — modern YouTube layout (transcript-segment-view-model)', () => {
  const doc = loadFixture('youtube-transcript-modern.html')

  it('finds every segment via the modern selector', () => {
    expect(getSegmentElements(doc)).toHaveLength(3)
  })

  it('reads timestamp and text separately, never falling back to raw textContent', () => {
    const [first] = getSegmentElements(doc)
    const segment = readSegment(first as Element)
    // A naive `el.textContent` read would smash the timestamp, the a11y
    // duration label, and the caption text together with no separators —
    // asserting the exact split guards against that regression.
    expect(segment).toEqual({ timestamp: '0:01', text: '[♪♪♪]' })
  })

  it('assembles the full transcript in "[timestamp] text" lines, in document order', () => {
    expect(assembleTranscript(doc)).toBe(
      [
        "[0:01] [♪♪♪]",
        "[0:18] ♪ We're no strangers to love ♪ ♪ You know the rules and so do I ♪",
        '[3:23] ♪ Never gonna make you cry ♪ ♪ Never gonna say goodbye ♪',
      ].join('\n'),
    )
  })
})

describe('assembleTranscript — legacy YouTube layout (ytd-transcript-segment-renderer)', () => {
  const doc = loadFixture('youtube-transcript-legacy.html')

  it('falls back to the legacy selectors when no modern segments exist', () => {
    expect(getSegmentElements(doc)).toHaveLength(2)
  })

  it('assembles the transcript from the legacy structure', () => {
    expect(assembleTranscript(doc)).toBe(
      [
        '[0:00] Today we are looking at how eval harnesses break down',
        '[0:12] past a few thousand queries.',
      ].join('\n'),
    )
  })
})

describe('assembleTranscript — no transcript present', () => {
  it('returns an empty string rather than throwing when there are no segments at all', () => {
    const empty = new JSDOM('<div id="panel-root"></div>').window.document
    expect(getSegmentElements(empty)).toHaveLength(0)
    expect(assembleTranscript(empty)).toBe('')
  })
})

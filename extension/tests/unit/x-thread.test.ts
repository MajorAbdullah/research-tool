import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { orderThreadPosts } from '../../src/content/x-thread-order'
import { walkXThread } from '../../src/content/x-thread'

describe('orderThreadPosts (pure)', () => {
  it('sorts ascending by numeric id, independent of input order', () => {
    const input = [{ id: '30' }, { id: '10' }, { id: '20' }]
    expect(orderThreadPosts(input)).toEqual([{ id: '10' }, { id: '20' }, { id: '30' }])
  })

  it('sorts correctly for ids far larger than Number.MAX_SAFE_INTEGER (real Snowflake IDs)', () => {
    // Twitter/X status ids are 64-bit Snowflake ids — well past 2^53, where
    // plain `Number()` comparison silently loses precision. This is exactly
    // why orderThreadPosts compares with BigInt instead.
    const input = [
      { id: '1953405076756570223' },
      { id: '1953405076756570221' },
      { id: '1953405076756570222' },
    ]
    expect(orderThreadPosts(input)).toEqual([
      { id: '1953405076756570221' },
      { id: '1953405076756570222' },
      { id: '1953405076756570223' },
    ])
  })

  it('dedupes repeated ids, keeping the first occurrence', () => {
    const input = [
      { id: '2', label: 'first-seen' },
      { id: '1', label: 'only' },
      { id: '2', label: 'later-duplicate' },
    ]
    expect(orderThreadPosts(input)).toEqual([
      { id: '1', label: 'only' },
      { id: '2', label: 'first-seen' },
    ])
  })

  it('is a no-op on an already-ordered, already-deduped list', () => {
    const input = [{ id: '1' }, { id: '2' }, { id: '3' }]
    expect(orderThreadPosts(input)).toEqual(input)
  })
})

describe('walkXThread (fixture DOM)', () => {
  it('re-orders posts into id order regardless of DOM order, dedupes, and ignores non-post articles', () => {
    const html = readFileSync(new URL('../fixtures/x-thread.html', import.meta.url), 'utf-8')
    const doc = new JSDOM(html).window.document

    const html_ = walkXThread(doc)
    expect(html_).not.toBeNull()

    // Order in the returned HTML should be first, second, third — even
    // though the fixture's DOM order is third, first, second-duplicate, second.
    const firstIdx = html_!.indexOf('First post in the thread.')
    const secondIdx = html_!.indexOf('Second post in the thread.')
    const thirdIdx = html_!.indexOf('Third post in the thread')
    expect(firstIdx).toBeGreaterThanOrEqual(0)
    expect(secondIdx).toBeGreaterThan(firstIdx)
    expect(thirdIdx).toBeGreaterThan(secondIdx)

    // The duplicate (same status id, different DOM node/text) must not appear.
    expect(html_).not.toContain('appears twice in the DOM')

    // The ad/promoted card with no status permalink must be excluded entirely.
    expect(html_).not.toContain('promoted/ad card')
  })

  it('returns null when the page has no posts with a status permalink', () => {
    const doc = new JSDOM('<main><article>just chrome, no post</article></main>').window.document
    expect(walkXThread(doc)).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { renderMarkdown } from '@/app/(chat)/chat/components/render-markdown'

const html = (src: string) => renderToStaticMarkup(<>{renderMarkdown(src)}</>)

describe('renderMarkdown', () => {
  it('renders bold, italic and inline code', () => {
    const out = html('a **bold** and *ital* and `code`')
    expect(out).toContain('<strong')
    expect(out).toContain('bold')
    expect(out).toContain('<em')
    expect(out).toContain('<code')
  })

  it('groups consecutive bullets into one list', () => {
    const out = html('intro\n- one\n- two\nafter')
    expect((out.match(/<ul/g) ?? []).length).toBe(1)
    expect((out.match(/<li/g) ?? []).length).toBe(2)
  })

  /**
   * The whole point of hand-rolling this instead of taking a markdown dependency: an answer is
   * synthesised from untrusted saved content, so it must be impossible for model output to
   * become markup.
   */
  it('never emits raw HTML from model output', () => {
    const out = html('<script>alert(1)</script> and <img src=x onerror=y>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;script&gt;')
  })

  it('does not turn markdown links into anchors', () => {
    const out = html('see [click me](https://evil.example)')
    expect(out).not.toContain('<a ')
    expect(out).toContain('click me')
  })

  it('drops blank lines rather than emitting empty paragraphs', () => {
    expect(html('one\n\n\ntwo')).toBe(
      '<p class="my-2 first:mt-0 last:mb-0">one</p><p class="my-2 first:mt-0 last:mb-0">two</p>',
    )
  })
})

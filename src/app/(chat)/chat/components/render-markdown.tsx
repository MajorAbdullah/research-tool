import type { ReactNode } from 'react'

/**
 * A deliberately tiny markdown renderer for chat answers.
 *
 * Models reliably emit `**bold**`, `` `code` `` and `- ` bullets, and rendering those as literal
 * asterisks makes a correct answer look broken. A full markdown library is the wrong trade here:
 * it is a dependency and a sanitiser surface for four constructs, and CLAUDE.md's KISS rule (plus
 * the precedent of P5 hand-writing its own variants helper rather than adding `cva`) points the
 * other way.
 *
 * Safety: this never produces HTML. It returns React elements from plain-text slices, so model
 * output cannot inject markup — which matters because an answer is synthesised from untrusted
 * saved content. There is deliberately no link or image syntax support: a model-authored
 * `[text](url)` would be an injected navigation target, and citations already have their own
 * first-class chips.
 */

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyPrefix}-${i}`
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={key} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      )
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={key} className="italic">
          {part.slice(1, -1)}
        </em>
      )
    }
    return part
  })
}

/** Groups consecutive `- ` / `* ` lines into a single list so bullets don't render as paragraphs. */
export function renderMarkdown(source: string): ReactNode {
  const lines = source.split('\n')
  const blocks: ReactNode[] = []
  let bullets: string[] = []

  const flushBullets = () => {
    if (bullets.length === 0) return
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="my-2 list-disc space-y-1 pl-5">
        {bullets.map((b, i) => (
          <li key={i}>{renderInline(b, `li-${blocks.length}-${i}`)}</li>
        ))}
      </ul>,
    )
    bullets = []
  }

  lines.forEach((line, i) => {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet?.[1] !== undefined) {
      bullets.push(bullet[1])
      return
    }
    flushBullets()
    if (line.trim() === '') return
    blocks.push(
      <p key={`p-${i}`} className="my-2 first:mt-0 last:mb-0">
        {renderInline(line, `p-${i}`)}
      </p>,
    )
  })
  flushBullets()

  return blocks
}

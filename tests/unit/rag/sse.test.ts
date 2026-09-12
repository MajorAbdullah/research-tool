import { describe, expect, it } from 'vitest'
import { formatSseEvent } from '@/lib/rag/sse'

describe('formatSseEvent', () => {
  it('frames an event name and a JSON data line, terminated by a blank line', () => {
    expect(formatSseEvent('sources', { sources: [] })).toBe(
      'event: sources\ndata: {"sources":[]}\n\n',
    )
  })

  it('serializes the data payload as a single JSON line regardless of nesting', () => {
    const frame = formatSseEvent('done', { conversation_id: 'cnv_1', grounded: true })
    expect(frame.startsWith('event: done\ndata: ')).toBe(true)
    expect(frame.endsWith('\n\n')).toBe(true)
    const dataLine = frame.split('\n')[1]?.replace(/^data: /, '') ?? ''
    expect(JSON.parse(dataLine)).toEqual({ conversation_id: 'cnv_1', grounded: true })
  })
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  isZipBuffer,
  listZipEntryNames,
  readZipEntry,
  ZipFormatError,
} from '../../../src/lib/importers/zip'
import { extractChatText } from '../../../src/lib/importers/source'

const FIXTURES_DIR = fileURLToPath(new URL('../../fixtures/whatsapp/', import.meta.url))

function fixture(name: string): Buffer {
  return readFileSync(`${FIXTURES_DIR}${name}`)
}

describe('isZipBuffer', () => {
  it('recognizes a real zip archive by its magic bytes', () => {
    expect(isZipBuffer(fixture('android-export.zip'))).toBe(true)
  })

  it('does not mistake plain text for a zip', () => {
    expect(isZipBuffer(fixture('ios-basic.txt'))).toBe(false)
  })
})

describe('readZipEntry / listZipEntryNames', () => {
  it('lists both the chat file and the ignored media entry', () => {
    const names = listZipEntryNames(fixture('android-export.zip'))
    expect(names).toContain('_chat.txt')
    expect(names).toContain('00001-PHOTO.jpg')
  })

  it('reads _chat.txt out of a flat (no-subfolder) export matching the android fixture content', () => {
    const data = readZipEntry(fixture('android-export.zip'), '_chat.txt')
    expect(data).not.toBeNull()
    expect(data!.toString('utf-8')).toBe(fixture('android-basic.txt').toString('utf-8'))
  })

  it('finds _chat.txt nested one folder deep via suffix matching', () => {
    const data = readZipEntry(fixture('ios-export-subfolder.zip'), '_chat.txt')
    expect(data).not.toBeNull()
    expect(data!.toString('utf-8')).toBe(fixture('ios-basic.txt').toString('utf-8'))
  })

  it('returns null (never throws) when no _chat.txt is present', () => {
    expect(readZipEntry(fixture('no-chat-file.zip'), '_chat.txt')).toBeNull()
  })
})

describe('extractChatText', () => {
  it('extracts chat text from a zip upload', () => {
    const text = extractChatText(fixture('android-export.zip'))
    expect(text).toBe(fixture('android-basic.txt').toString('utf-8'))
  })

  it('passes a plain .txt upload through unchanged', () => {
    const text = extractChatText(fixture('ios-basic.txt'))
    expect(text).toBe(fixture('ios-basic.txt').toString('utf-8'))
  })

  it('throws a clear ZipFormatError when a zip has no _chat.txt', () => {
    expect(() => extractChatText(fixture('no-chat-file.zip'))).toThrow(ZipFormatError)
  })
})

import { inflateRawSync } from 'node:zlib'

/**
 * Minimal, dependency-free ZIP reader — just enough to pull `_chat.txt` out of a
 * WhatsApp "Export Chat -> Without Media" archive and ignore every media entry
 * entirely (P12.3). No zip library is in Sieve's dependency set, and adding one is
 * outside P12's file scope (`package.json` belongs to the whole project, not this
 * phase's `src/lib/importers/**`) — WhatsApp export zips are small, few-entry
 * archives, and the ZIP central-directory format is simple enough to parse directly
 * against Node's built-in `zlib` for inflation.
 */

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_DIR_SIGNATURE = 0x02014b50
const LOCAL_HEADER_SIGNATURE = 0x04034b50
const EOCD_MIN_SIZE = 22
const MAX_COMMENT_LENGTH = 65535

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipFormatError'
  }
}

/** Sniffs the local-file-header magic bytes rather than trusting a `.zip` filename. */
export function isZipBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === LOCAL_HEADER_SIGNATURE
}

interface CentralDirEntry {
  name: string
  compressionMethod: number
  compressedSize: number
  localHeaderOffset: number
}

function findEndOfCentralDirectory(buf: Buffer): number {
  const maxScan = Math.min(buf.length, EOCD_MIN_SIZE + MAX_COMMENT_LENGTH)
  const earliestStart = buf.length - maxScan
  for (let i = buf.length - EOCD_MIN_SIZE; i >= earliestStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i
  }
  throw new ZipFormatError('not a valid zip file: end-of-central-directory record not found')
}

function readCentralDirectory(buf: Buffer): CentralDirEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buf)
  const totalEntries = buf.readUInt16LE(eocdOffset + 10)
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16)

  const entries: CentralDirEntry[] = []
  let offset = centralDirOffset
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(offset) !== CENTRAL_DIR_SIGNATURE) {
      throw new ZipFormatError(
        `corrupt zip: expected a central directory entry at offset ${offset}`,
      )
    }
    const compressionMethod = buf.readUInt16LE(offset + 10)
    const compressedSize = buf.readUInt32LE(offset + 20)
    const nameLength = buf.readUInt16LE(offset + 28)
    const extraLength = buf.readUInt16LE(offset + 30)
    const commentLength = buf.readUInt16LE(offset + 32)
    const localHeaderOffset = buf.readUInt32LE(offset + 42)
    const name = buf.toString('utf-8', offset + 46, offset + 46 + nameLength)
    entries.push({ name, compressionMethod, compressedSize, localHeaderOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function readEntryData(buf: Buffer, entry: CentralDirEntry): Buffer {
  const offset = entry.localHeaderOffset
  if (buf.readUInt32LE(offset) !== LOCAL_HEADER_SIGNATURE) {
    throw new ZipFormatError(`corrupt zip: expected a local file header at offset ${offset}`)
  }
  const nameLength = buf.readUInt16LE(offset + 26)
  const extraLength = buf.readUInt16LE(offset + 28)
  const dataStart = offset + 30 + nameLength + extraLength
  const compressed = buf.subarray(dataStart, dataStart + entry.compressedSize)

  if (entry.compressionMethod === 0) return Buffer.from(compressed) // stored, no compression
  if (entry.compressionMethod === 8) return inflateRawSync(compressed) // deflate
  throw new ZipFormatError(
    `unsupported zip compression method ${entry.compressionMethod} for "${entry.name}"`,
  )
}

/**
 * Finds an entry by exact name, falling back to "any entry whose path ends with this
 * name" so a `_chat.txt` nested one folder deep (some export flows add a
 * "WhatsApp Chat - X/" prefix) is still found. Returns `null` (never throws) when no
 * matching entry exists, so the caller can turn that into a normal validation error
 * rather than an unhandled exception.
 */
export function readZipEntry(buf: Buffer, entryName: string): Buffer | null {
  const entries = readCentralDirectory(buf)
  const lowerName = entryName.toLowerCase()
  const exact = entries.find((e) => e.name === entryName)
  const target = exact ?? entries.find((e) => e.name.toLowerCase().endsWith(`/${lowerName}`))
  if (!target) return null
  return readEntryData(buf, target)
}

export function listZipEntryNames(buf: Buffer): string[] {
  return readCentralDirectory(buf).map((e) => e.name)
}

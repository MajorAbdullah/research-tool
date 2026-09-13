/**
 * Packages `extension/dist` into a ZIP the user can download from Settings, so installing the
 * browser extension never requires a checkout or a build step — which matters once Sieve lives on
 * a VPS and the machine you install the extension on is not the machine the code is on.
 *
 * Writes the archive by hand with `node:zlib`, mirroring `src/lib/importers/zip.ts`, which already
 * reads ZIPs the same way with `inflateRawSync`. That precedent (plus P5's hand-written variants
 * helper and the chat markdown renderer) is the house style: no dependency for a small, fully
 * specified format. The round-trip test feeds the output back through that existing reader AND
 * through the system `unzip`, so this is validated against something other than itself.
 *
 * ZIP layout produced (the classic, most-compatible subset):
 *   [local file header + deflated data] × n
 *   [central directory header] × n
 *   [end of central directory]
 * No ZIP64, no encryption, no data descriptors — an unpacked Chrome extension is a handful of
 * small files, far below every limit that would require them.
 */
import { deflateRawSync } from 'node:zlib'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** DOS time/date. Fixed, not `now`, so the same input always yields a byte-identical archive. */
const DOS_TIME = 0
const DOS_DATE = 0x2821 // 2000-01-01

interface Entry {
  /** Forward-slash path inside the archive — ZIP requires `/` regardless of platform. */
  name: string
  data: Buffer
}

function collect(dir: string, root = dir): Entry[] {
  const out: Entry[] = []
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name)
    if (item.isDirectory()) {
      out.push(...collect(full, root))
    } else if (item.isFile()) {
      out.push({ name: relative(root, full).split(sep).join('/'), data: readFileSync(full) })
    }
  }
  return out
}

export function zipDirectory(dir: string): Buffer {
  const entries = collect(dir)
  if (entries.length === 0) throw new Error(`Nothing to package — ${dir} is empty.`)

  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const compressed = deflateRawSync(entry.data, { level: 9 })
    const crc = crc32(entry.data)

    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0) // local file header signature
    local.writeUInt16LE(20, 4) // version needed (2.0 = deflate)
    local.writeUInt16LE(0x0800, 6) // flags: bit 11 = UTF-8 names
    local.writeUInt16LE(8, 8) // method: deflate
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra field length
    nameBuf.copy(local, 30)
    locals.push(local, compressed)

    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0) // central directory header signature
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk number
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0o644 << 16, 38) // external attrs: regular file, rw-r--r--
    central.writeUInt32LE(offset, 42) // offset of local header
    nameBuf.copy(central, 46)
    centrals.push(central)

    offset += local.length + compressed.length
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0) // end of central directory signature
  end.writeUInt16LE(0, 4) // this disk
  end.writeUInt16LE(0, 6) // disk with central dir
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...locals, ...centrals, end])
}

/** Where the built extension lives, in dev and inside the container. */
export const EXTENSION_DIST_CANDIDATES = [
  join(process.cwd(), 'extension', 'dist'),
  join(process.cwd(), '..', '..', 'extension', 'dist'),
]

export function findExtensionDist(): string | null {
  for (const dir of EXTENSION_DIST_CANDIDATES) {
    try {
      if (statSync(dir).isDirectory() && readdirSync(dir).length > 0) return dir
    } catch {
      // candidate doesn't exist — try the next
    }
  }
  return null
}

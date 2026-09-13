import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { zipDirectory, findExtensionDist } from '@/lib/extension-package'
import { listZipEntryNames, readZipEntry } from '@/lib/importers'

/**
 * The ZIP writer is hand-rolled (no dependency, matching how importers/zip.ts hand-rolls the
 * READER). So it must be validated against something other than itself: these tests round-trip
 * through that independent reader, and through the system `unzip -t` where available.
 */
describe('zipDirectory', () => {
  function fixtureDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'sieve-zip-'))
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ name: 'x', version: '1' }))
    mkdirSync(join(dir, 'icons'))
    writeFileSync(join(dir, 'icons', 'a.txt'), 'nested file contents')
    // Compressible, to exercise deflate rather than a trivially small payload.
    writeFileSync(join(dir, 'big.js'), 'console.log("hello");\n'.repeat(500))
    return dir
  }

  it('round-trips through the independent reader in importers/zip.ts', () => {
    const dir = fixtureDir()
    try {
      const zip = zipDirectory(dir)
      const names = listZipEntryNames(zip).sort()
      expect(names).toEqual(['big.js', 'icons/a.txt', 'manifest.json'])

      expect(readZipEntry(zip, 'icons/a.txt')?.toString('utf8')).toBe('nested file contents')
      expect(readZipEntry(zip, 'big.js')?.toString('utf8')).toBe(
        'console.log("hello");\n'.repeat(500),
      )
      expect(JSON.parse(readZipEntry(zip, 'manifest.json')!.toString('utf8'))).toEqual({
        name: 'x',
        version: '1',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('actually compresses rather than storing', () => {
    const dir = fixtureDir()
    try {
      const zip = zipDirectory(dir)
      // The repeated JS alone is ~11 KB uncompressed; a stored archive could not be this small.
      expect(zip.length).toBeLessThan(4_000)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes the system unzip integrity check', () => {
    const dir = fixtureDir()
    const out = join(dir, '..', `verify-${Date.now()}.zip`)
    try {
      writeFileSync(out, zipDirectory(dir))
      // `unzip -t` is a completely independent implementation — if the central directory,
      // CRCs or offsets are wrong, this fails.
      const result = execFileSync('unzip', ['-t', out], { encoding: 'utf8' })
      expect(result).toContain('No errors detected')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return // no unzip on this machine
      throw err
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(out, { force: true })
    }
  })

  it('refuses to package an empty directory rather than emitting a valid-but-useless zip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sieve-zip-empty-'))
    try {
      expect(() => zipDirectory(dir)).toThrow(/empty/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('finds the built extension when present', () => {
    const found = findExtensionDist()
    if (existsSync(join(process.cwd(), 'extension', 'dist'))) {
      expect(found).toBeTruthy()
    }
  })
})

import { isZipBuffer, readZipEntry, ZipFormatError } from './zip'

const CHAT_FILE_NAME = '_chat.txt'

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * Accepts either a raw `_chat.txt` upload or a `.zip` export (P12.3) and returns the
 * chat transcript text either way — sniffed from the file's actual bytes rather than
 * trusted from its name/extension. Media entries inside a zip are ignored entirely;
 * only `_chat.txt` (or an entry ending in `/_chat.txt`, for a nested-folder export) is
 * ever read.
 */
export function extractChatText(fileBuffer: Buffer): string {
  if (isZipBuffer(fileBuffer)) {
    const entry = readZipEntry(fileBuffer, CHAT_FILE_NAME)
    if (!entry) {
      throw new ZipFormatError(`no ${CHAT_FILE_NAME} found in the uploaded archive`)
    }
    return stripBom(entry.toString('utf-8'))
  }
  return stripBom(fileBuffer.toString('utf-8'))
}

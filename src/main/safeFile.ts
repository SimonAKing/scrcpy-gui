import { constants } from 'node:fs'
import { open } from 'node:fs/promises'

const READ_CHUNK_BYTES = 64 * 1024

export async function readBoundedRegularUtf8File(
  path: string,
  maxBytes: number,
  invalidMessage: string
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('File size limit must be a positive integer.')

  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > maxBytes) throw new TypeError(invalidMessage)

    const chunks: Buffer[] = []
    let totalBytes = 0
    while (totalBytes <= maxBytes) {
      const remaining = maxBytes + 1 - totalBytes
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining))
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null)
      if (bytesRead === 0) break
      chunks.push(chunk.subarray(0, bytesRead))
      totalBytes += bytesRead
    }
    if (totalBytes > maxBytes) throw new TypeError(invalidMessage)
    return Buffer.concat(chunks, totalBytes).toString('utf8')
  } finally {
    await handle.close()
  }
}

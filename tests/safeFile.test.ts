import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readBoundedRegularUtf8File } from '../src/main/safeFile'

const directories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'scrcpy-gui-safe-file-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('readBoundedRegularUtf8File', () => {
  it('reads a regular file through the descriptor that was validated', async () => {
    const directory = await temporaryDirectory()
    const path = join(directory, 'config.json')
    await writeFile(path, '{"safe":true}\n', 'utf8')

    await expect(readBoundedRegularUtf8File(path, 64, 'invalid file')).resolves.toBe('{"safe":true}\n')
  })

  it('rejects directories and files over the byte limit', async () => {
    const directory = await temporaryDirectory()
    const nested = join(directory, 'nested')
    const oversized = join(directory, 'oversized.json')
    await mkdir(nested)
    await writeFile(oversized, '12345', 'utf8')

    await expect(readBoundedRegularUtf8File(nested, 4, 'invalid file')).rejects.toThrow('invalid file')
    await expect(readBoundedRegularUtf8File(oversized, 4, 'invalid file')).rejects.toThrow('invalid file')
  })

  it.runIf(process.platform !== 'win32')('does not follow a symbolic link', async () => {
    const directory = await temporaryDirectory()
    const target = join(directory, 'target.json')
    const link = join(directory, 'link.json')
    await writeFile(target, '{"secret":true}', 'utf8')
    await symlink(target, link)

    await expect(readBoundedRegularUtf8File(link, 64, 'invalid file')).rejects.toMatchObject({ code: 'ELOOP' })
  })
})

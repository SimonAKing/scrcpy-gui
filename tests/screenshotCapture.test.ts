import { access, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { captureScreenshotPng } from '../src/main/processes'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])

describe('screenshot capture', () => {
  it('returns a valid direct ADB screenshot without creating a remote file', async () => {
    const commands: string[][] = []
    const captured = await captureScreenshotPng('/runtime/adb', 'SERIAL', {
      binary: async () => png,
      command: async (_file, args) => {
        commands.push(args)
        return { stdout: '', stderr: '' }
      }
    })

    expect(captured).toEqual(png)
    expect(commands).toEqual([])
  })

  it('falls back to a pulled device file when exec-out does not return PNG data', async () => {
    const commands: string[][] = []
    let pulledPath = ''
    const captured = await captureScreenshotPng('/runtime/adb', ' SERIAL ', {
      binary: async () => Buffer.from('vendor shell output'),
      command: async (_file, args) => {
        commands.push(args)
        if (args[2] === 'pull') {
          pulledPath = args[4]
          await writeFile(pulledPath, png)
        }
        return { stdout: '', stderr: '' }
      }
    })

    expect(captured).toEqual(png)
    expect(commands).toHaveLength(3)
    expect(commands[0].slice(0, 5)).toEqual(['-s', 'SERIAL', 'shell', 'screencap', '-p'])
    expect(commands[1].slice(0, 4)).toEqual(['-s', 'SERIAL', 'pull', commands[0][5]])
    expect(commands[2]).toEqual(['-s', 'SERIAL', 'shell', 'rm', '-f', commands[0][5]])
    await expect(access(pulledPath)).rejects.toBeTruthy()
  })
})

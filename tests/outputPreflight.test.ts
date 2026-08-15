import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultLaunchConfig } from '../src/shared/config'
import { duplicateRecordingPath, preflightLaunchOutputs } from '../src/main/processes'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('launch output preflight', () => {
  it('accepts a writable recording destination with available space', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'scrcpy-output-'))
    directories.push(directory)
    const launch = defaultLaunchConfig()
    launch.recordEnabled = true
    launch.recordPath = join(directory, 'capture.mp4')
    await expect(preflightLaunchOutputs(launch)).resolves.toBeUndefined()
  })

  it('rejects missing recording directories and non-device V4L2 sinks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'scrcpy-output-'))
    directories.push(directory)
    const launch = defaultLaunchConfig()
    launch.recordEnabled = true
    launch.recordPath = join(directory, 'missing', 'capture.mp4')
    await expect(preflightLaunchOutputs(launch)).rejects.toBeTruthy()

    launch.recordEnabled = false
    launch.recordPath = ''
    launch.v4l2Sink = join(directory, 'video2')
    await writeFile(launch.v4l2Sink, '')
    await expect(preflightLaunchOutputs(launch)).rejects.toThrow('not a character device')
  })

  it('detects duplicate manual multi-device recording targets but permits generated names', () => {
    const launch = defaultLaunchConfig()
    launch.recordEnabled = true
    launch.recordPath = join(tmpdir(), 'same-capture.mp4')
    expect(duplicateRecordingPath([
      { serial: 'ONE', launch }, { serial: 'TWO', launch: structuredClone(launch) }
    ])).toBeTruthy()

    launch.autoRecordName = true
    expect(duplicateRecordingPath([
      { serial: 'ONE', launch }, { serial: 'TWO', launch: structuredClone(launch) }
    ])).toBeUndefined()
  })
})

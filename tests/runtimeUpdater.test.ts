import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeCommand, resolveBinary, setManagedRuntimeDirectory } from '../src/main/runtime'
import { isNewerVersion, RuntimeUpdater, selectRelease, validateArchiveListing } from '../src/main/runtimeUpdater'

vi.mock('../src/main/runtime', async (original) => {
  const runtime = await original<typeof import('../src/main/runtime')>()
  return {
    ...runtime,
    executeCommand: vi.fn(async (file: string, args: string[]) => {
      if (file === 'tar') return runtime.executeCommand(file, args)
      return { stdout: await readFile(file, 'utf8'), stderr: '' }
    })
  }
})

let directory = ''
let originalResources: PropertyDescriptor | undefined
let archive: Buffer
let release: ReturnType<typeof releaseMetadata>
const suffix = process.platform === 'win32' ? '.exe' : ''
const target = process.platform === 'darwin' ? `macos-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}`
  : process.platform === 'win32' ? (process.arch === 'ia32' ? 'win32' : process.arch === 'arm64' ? 'winarm64' : 'win64') : 'linux-x86_64'
const archiveRoot = `scrcpy-${target}-v5.0.1`
const file = `${archiveRoot}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`

function releaseMetadata(bytes: Buffer) {
  return { tag_name: 'v5.0.1', draft: false, prerelease: false, assets: [
    { name: file, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, size: bytes.length }
  ] }
}

async function binary(folder: string, name: string, output: string): Promise<void> {
  const path = join(folder, `${name}${suffix}`)
  await writeFile(path, output)
  await chmod(path, 0o755)
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'scrcpy-updater-test-'))
  originalResources = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  Object.defineProperty(process, 'resourcesPath', { value: join(directory, 'resources'), configurable: true })
  const bundled = join(process.resourcesPath, 'scrcpy')
  await mkdir(bundled, { recursive: true })
  await binary(bundled, 'scrcpy', 'scrcpy 4.1\n')
  await binary(bundled, 'adb', 'Android Debug Bridge version 1.0.41\n')
  const fixture = join(directory, archiveRoot)
  await mkdir(fixture)
  await binary(fixture, 'scrcpy', 'scrcpy 5.0.1\n')
  await binary(fixture, 'adb', 'Android Debug Bridge version 1.0.41\nVersion 37.0.0\n')
  await writeFile(join(fixture, 'scrcpy-server'), 'server')
  await writeFile(join(fixture, process.platform === 'win32' ? 'LICENSE.txt' : 'LICENSE'), 'Apache License\nVersion 2.0')
  const fixtureArchive = join(directory, 'fixture.tar.gz')
  execFileSync('tar', ['-czf', fixtureArchive, '-C', directory, archiveRoot])
  archive = await readFile(fixtureArchive)
  release = releaseMetadata(archive)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(
    url.includes('/releases/latest') ? JSON.stringify(release) : new Uint8Array(archive)
  )))
  setManagedRuntimeDirectory('')
})

afterEach(async () => {
  setManagedRuntimeDirectory('')
  if (originalResources) Object.defineProperty(process, 'resourcesPath', originalResources)
  else Reflect.deleteProperty(process, 'resourcesPath')
  vi.unstubAllGlobals()
  vi.mocked(executeCommand).mockClear()
  await rm(directory, { recursive: true, force: true })
})

describe('official runtime release selection', () => {
  it.each([
    ['darwin', 'arm64', 'macos-aarch64', 'tar.gz'], ['darwin', 'x64', 'macos-x86_64', 'tar.gz'],
    ['win32', 'x64', 'win64', 'zip'], ['win32', 'ia32', 'win32', 'zip'],
    ['win32', 'arm64', 'winarm64', 'zip'], ['linux', 'x64', 'linux-x86_64', 'tar.gz']
  ])('selects the exact official artifact for %s/%s', (platform, arch, name, extension) => {
    const metadata = { ...release, assets: [{ ...release.assets[0], name: `scrcpy-${name}-v5.0.1.${extension}` }] }
    expect(selectRelease(metadata, platform, arch).file).toBe(metadata.assets[0].name)
  })

  it('rejects unsupported targets, prereleases, and assets without SHA-256 digests', () => {
    expect(() => selectRelease(release, 'linux', 'arm64')).toThrow('not available')
    expect(() => selectRelease({ ...release, prerelease: true }, process.platform, process.arch)).toThrow('stable')
    expect(() => selectRelease({ ...release, assets: [{ name: file, size: 123 }] }, process.platform, process.arch)).toThrow('checksum')
    expect(() => selectRelease(null, process.platform, process.arch)).toThrow('stable')
  })

  it('compares numeric versions without offering downgrades', () => {
    expect(isNewerVersion('5.0.1', '4.1')).toBe(true)
    expect(isNewerVersion('4.10', '4.9')).toBe(true)
    expect(isNewerVersion('5.0', '5.0.0')).toBe(false)
    expect(isNewerVersion('5.0.1', '6.0')).toBe(false)
  })

  it('rejects traversal, absolute paths, links, and special archive entries', () => {
    for (const name of ['/outside', `${archiveRoot}/../outside`, `${archiveRoot}/C:\\outside`]) {
      expect(() => validateArchiveListing(name, '-rw-r--r-- file', archiveRoot)).toThrow('unsafe')
    }
    expect(() => validateArchiveListing(`${archiveRoot}/link`, 'lrwxrwxrwx link', archiveRoot)).toThrow('links')
  })
})

describe('runtime installation and recovery', () => {
  it('installs and persists a verified bundle, preserves custom paths, and restores the original', async () => {
    const updater = new RuntimeUpdater(directory)
    await updater.initialize()
    const bundled = await resolveBinary({ scrcpyPath: '' }, 'scrcpy')
    expect(await updater.check()).toEqual({ version: '5.0.1', available: true })
    await updater.install()
    const updated = await resolveBinary({ scrcpyPath: '' }, 'scrcpy')
    expect(updated).toContain(join('runtime-updates', 'bundle-'))
    expect(await resolveBinary({ scrcpyPath: '' }, 'adb')).toBe(join(updated, '..', `adb${suffix}`))
    expect(await resolveBinary({ scrcpyPath: bundled }, 'scrcpy')).toBe(bundled)
    const restarted = new RuntimeUpdater(directory)
    await restarted.initialize()
    expect(await resolveBinary({ scrcpyPath: '' }, 'scrcpy')).toBe(updated)
    expect(await restarted.check()).toEqual({ version: '5.0.1', available: false })
    await expect(restarted.install()).rejects.toThrow('Check for runtime updates')
    await restarted.restoreBundled()
    expect(await resolveBinary({ scrcpyPath: '' }, 'scrcpy')).toBe(bundled)
    expect(await readFile(updated, 'utf8')).toContain('5.0.1')
    await new RuntimeUpdater(directory).initialize()
    expect(await resolveBinary({ scrcpyPath: '' }, 'scrcpy')).toBe(bundled)
  })

  it('keeps the existing runtime on a checksum failure', async () => {
    const updater = new RuntimeUpdater(directory)
    const original = await resolveBinary({ scrcpyPath: '' }, 'scrcpy')
    await updater.check()
    archive = Buffer.from('corrupt download')
    await expect(updater.install()).rejects.toThrow('checksum')
    expect(await resolveBinary({ scrcpyPath: '' }, 'scrcpy')).toBe(original)
  })

  it('rejects a bundle with a mismatched executable version before activating it', async () => {
    await binary(join(directory, archiveRoot), 'scrcpy', 'scrcpy 5.0.2\n')
    const archivePath = join(directory, 'mismatched.tar.gz')
    execFileSync('tar', ['-czf', archivePath, '-C', directory, archiveRoot])
    archive = await readFile(archivePath)
    release = releaseMetadata(archive)
    const updater = new RuntimeUpdater(directory)
    const original = await resolveBinary({ scrcpyPath: '' }, 'scrcpy')
    await updater.check()
    await expect(updater.install()).rejects.toThrow('version could not be verified')
    expect(await resolveBinary({ scrcpyPath: '' }, 'scrcpy')).toBe(original)
    expect(await readdir(join(directory, 'runtime-updates'))).toEqual([])
  })

  it('keeps a previously installed update if the next bundle fails verification', async () => {
    const updater = new RuntimeUpdater(directory)
    await updater.check()
    await updater.install()
    const previous = await resolveBinary({ scrcpyPath: '' }, 'scrcpy')
    release.tag_name = 'v5.0.2'
    release.assets[0].name = file.replace('5.0.1', '5.0.2')
    await updater.check()
    await expect(updater.install()).rejects.toThrow()
    expect(await resolveBinary({ scrcpyPath: '' }, 'scrcpy')).toBe(previous)
    await new RuntimeUpdater(directory).initialize()
    expect(await resolveBinary({ scrcpyPath: '' }, 'scrcpy')).toBe(previous)
    expect((await readdir(join(directory, 'runtime-updates'))).filter((name) => name.startsWith('staging-'))).toEqual([])
  })

  it('rejects overlapping update requests and retries after a network error', async () => {
    const updater = new RuntimeUpdater(directory)
    const checking = updater.check()
    await expect(updater.check()).rejects.toThrow('already in progress')
    await checking
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 403 }))
    await expect(updater.check()).rejects.toThrow('HTTP 403')
    await expect(updater.install()).rejects.toThrow('Check for runtime updates')
    expect((await updater.check()).available).toBe(true)
  })

  it('rechecks active sessions before activation and leaves no partial update', async () => {
    const guard = vi.fn().mockImplementationOnce(() => {}).mockImplementation(() => { throw new Error('Active session') })
    const updater = new RuntimeUpdater(directory, guard)
    const original = await resolveBinary({ scrcpyPath: '' }, 'scrcpy')
    await updater.check()
    await expect(updater.install()).rejects.toThrow('Active session')
    expect(await resolveBinary({ scrcpyPath: '' }, 'scrcpy')).toBe(original)
    expect(await readdir(join(directory, 'runtime-updates'))).toEqual([])
  })

  it('falls back to the original runtime for a broken or unsafe saved pointer', async () => {
    const root = join(directory, 'runtime-updates')
    await mkdir(root)
    for (const pointer of ['../../outside', 'bundle-missing']) {
      await writeFile(join(root, 'active'), pointer)
      await new RuntimeUpdater(directory).initialize()
      expect(await resolveBinary({ scrcpyPath: '' }, 'scrcpy')).toBe(join(process.resourcesPath, 'scrcpy', `scrcpy${suffix}`))
    }
  })
})

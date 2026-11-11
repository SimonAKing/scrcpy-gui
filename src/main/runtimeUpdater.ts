import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RuntimeUpdateInfo } from '../shared/types'
import { executeCommand, resolveBinary, setManagedRuntimeDirectory } from './runtime'

const RELEASE_API = 'https://api.github.com/repos/Genymobile/scrcpy/releases/latest'
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
const VERSION = /^(\d+)\.(\d+)(?:\.(\d+))?$/

interface Release {
  version: string
  file: string
  sha256: string
  size: number
}

export function isNewerVersion(latest: string, current: string): boolean {
  if (!VERSION.test(latest)) throw new Error('Invalid scrcpy release version.')
  if (!VERSION.test(current)) return true
  const left = latest.split('.').map(Number)
  const right = current.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) > (right[i] || 0)
  }
  return false
}

export function selectRelease(value: unknown, platform: string, arch: string): Release {
  const targets: Record<string, string> = {
    'darwin-arm64': 'macos-aarch64', 'darwin-x64': 'macos-x86_64',
    'linux-x64': 'linux-x86_64', 'win32-x64': 'win64', 'win32-ia32': 'win32', 'win32-arm64': 'winarm64'
  }
  const target = targets[`${platform}-${arch}`]
  if (!target) throw new Error(`Official scrcpy updates are not available for ${platform}/${arch}.`)
  const release = value as { tag_name?: string; draft?: boolean; prerelease?: boolean; assets?: unknown[] } | null
  const version = typeof release?.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : ''
  if (!VERSION.test(version) || Number(version.split('.')[0]) < 4 || release?.draft || release?.prerelease) {
    throw new Error('The upstream response is not a supported stable scrcpy release.')
  }
  const file = `scrcpy-${target}-v${version}.${platform === 'win32' ? 'zip' : 'tar.gz'}`
  const asset = release?.assets?.find((item) => (item as { name?: string })?.name === file) as
    { digest?: string; size?: number } | undefined
  if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '') ||
      !Number.isSafeInteger(asset.size) || asset.size! <= 0 || asset.size! > MAX_ARCHIVE_BYTES) {
    throw new Error(`No checksum-verified official download is available for ${platform}/${arch}.`)
  }
  return { version, file, sha256: asset.digest!.slice(7), size: asset.size! }
}

async function download(url: string, limit: number): Promise<Buffer> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'scrcpy-gui', Accept: 'application/vnd.github+json' }
    })
    if (!response.ok || !response.body) throw new Error(`Runtime download failed: HTTP ${response.status}.`)
    reader = response.body.getReader()
    const chunks: Buffer[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error('Runtime download exceeded its size limit.')
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks)
  } finally {
    controller.abort()
    reader?.releaseLock()
    clearTimeout(timer)
  }
}

// Only regular files and directories inside the single upstream archive root are accepted.
export function validateArchiveListing(names: string, details: string, root: string): void {
  const entries = names.trim().split(/\r?\n/)
  if (!entries.length || entries.length > 1000 || entries.some((name) =>
    !(name === `${root}/` || name.startsWith(`${root}/`)) ||
    /[\\:\x00-\x1f]/.test(name) || name.split('/').some((part) => part === '..' || part === '.')
  )) throw new Error('The runtime archive contains unsafe paths.')
  if (details.trim().split(/\r?\n/).some((line) => !/^[-d]/.test(line))) {
    throw new Error('The runtime archive contains links or special files.')
  }
}

export class RuntimeUpdater {
  private readonly root: string
  private release?: Release
  private busy = false

  constructor(userData: string, private readonly canActivate: () => void = () => {}) {
    this.root = join(userData, 'runtime-updates')
  }

  async initialize(): Promise<void> {
    setManagedRuntimeDirectory('')
    try {
      const id = (await readFile(join(this.root, 'active'), 'utf8')).trim()
      if (!/^bundle-[a-zA-Z0-9-]+$/.test(id)) return
      const directory = join(this.root, id)
      await this.verify(directory)
      setManagedRuntimeDirectory(directory)
    } catch {
      // A missing or broken update falls back to the original bundled runtime.
    }
  }

  async check(): Promise<RuntimeUpdateInfo> {
    return this.exclusive(async () => {
      this.release = undefined
      const release = selectRelease(JSON.parse((await download(RELEASE_API, 2 * 1024 * 1024)).toString('utf8')), process.platform, process.arch)
      const path = await resolveBinary({ scrcpyPath: '' }, 'scrcpy')
      let current = ''
      if (path) {
        const output = await executeCommand(path, ['--version']).catch(() => ({ stdout: '', stderr: '' }))
        current = `${output.stdout}\n${output.stderr}`.match(/\bscrcpy\s+(\d+\.\d+(?:\.\d+)?)(?:\s|$)/i)?.[1] || ''
      }
      const available = isNewerVersion(release.version, current)
      if (available) this.release = release
      return { version: release.version, available }
    })
  }

  async install(): Promise<void> {
    return this.exclusive(async () => {
      this.canActivate()
      const release = this.release
      if (!release) throw new Error('Check for runtime updates before installing.')
      const archive = await download(`https://github.com/Genymobile/scrcpy/releases/download/v${release.version}/${release.file}`, MAX_ARCHIVE_BYTES)
      if (archive.length !== release.size || createHash('sha256').update(archive).digest('hex') !== release.sha256) {
        throw new Error('Runtime checksum verification failed. The existing runtime was kept.')
      }
      await mkdir(this.root, { recursive: true })
      const staging = await mkdtemp(join(this.root, 'staging-'))
      const id = `bundle-${release.version.replaceAll('.', '-')}-${randomUUID()}`
      const destination = join(this.root, id)
      let activated = false
      try {
        const archivePath = join(staging, release.file)
        const extracted = join(staging, 'extracted')
        await writeFile(archivePath, archive)
        await mkdir(extracted)
        const root = release.file.replace(/\.(tar\.gz|zip)$/, '')
        const names = await executeCommand('tar', ['-tf', archivePath], 30_000)
        const details = await executeCommand('tar', ['-tvf', archivePath], 30_000)
        validateArchiveListing(names.stdout, details.stdout, root)
        await executeCommand('tar', ['-xf', archivePath, '-C', extracted, '--strip-components=1'], 60_000)
        await this.verify(extracted, release.version)
        await rename(extracted, destination)
        // Recheck after the download: a session may have started in the meantime.
        this.canActivate()
        await writeFile(join(staging, 'active'), `${id}\n`)
        await rename(join(staging, 'active'), join(this.root, 'active'))
        setManagedRuntimeDirectory(destination)
        activated = true
        this.release = undefined
      } finally {
        if (!activated) await rm(destination, { recursive: true, force: true })
        await rm(staging, { recursive: true, force: true })
      }
    })
  }

  async restoreBundled(): Promise<void> {
    return this.exclusive(async () => {
      this.canActivate()
      await rm(join(this.root, 'active'), { force: true })
      setManagedRuntimeDirectory('')
      this.release = undefined
      // Keep old files: an ADB server may still hold them open on Windows.
    })
  }

  private async verify(directory: string, expectedVersion?: string): Promise<void> {
    const suffix = process.platform === 'win32' ? '.exe' : ''
    const scrcpy = await executeCommand(join(directory, `scrcpy${suffix}`), ['--version'])
    const version = `${scrcpy.stdout}\n${scrcpy.stderr}`.match(/\bscrcpy\s+(\d+\.\d+(?:\.\d+)?)(?:\s|$)/i)?.[1]
    if (!version || Number(version.split('.')[0]) < 4 || expectedVersion && version !== expectedVersion) {
      throw new Error('The downloaded scrcpy version could not be verified.')
    }
    const adb = await executeCommand(join(directory, `adb${suffix}`), ['version'])
    if (!/Android Debug Bridge version\s+\d/.test(`${adb.stdout}\n${adb.stderr}`)) {
      throw new Error('The downloaded bundle does not contain a working adb.')
    }
    await access(join(directory, 'scrcpy-server'))
    const license = await readFile(join(directory, process.platform === 'win32' ? 'LICENSE.txt' : 'LICENSE'), 'utf8')
    if (!/Apache License\s+Version 2\.0/s.test(license)) throw new Error('The runtime bundle is missing its license.')
  }

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('A runtime update operation is already in progress.')
    this.busy = true
    try { return await action() } finally { this.busy = false }
  }
}

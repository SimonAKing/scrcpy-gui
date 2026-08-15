import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import type {
  ApkInstallResult,
  BatchItemResult,
  BatchOperationResult,
  BatchProgressEvent,
  DeviceOverview,
  FileConflictPolicy,
  FileTransferResult,
  InstalledApp,
  RuntimeConfig
} from '../shared/types'
import { structuredErrorFromUnknown } from '../shared/errors'
import { adbService, type AdbClient } from './adbService'

export interface SelectedLocalFile {
  path: string
  name: string
  size: number
}

export type BatchProgressListener = (event: BatchProgressEvent) => void

function output(stdout: string, stderr: string): string {
  const value = `${stdout}\n${stderr}`.trim()
  return value.length > 16_384 ? `${value.slice(0, 16_383)}…` : value
}

function redactSourcePath(value: string, sourcePath: string, sourceName: string): string {
  return sourcePath ? value.split(sourcePath).join(sourceName) : value
}

function lines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

export function parsePackageIds(value: string): string[] {
  return [...new Set(lines(value).map((line) => {
    if (!line.startsWith('package:')) return undefined
    const body = line.slice('package:'.length)
    return body.includes('=') ? body.slice(body.lastIndexOf('=') + 1) : body
  }).filter((packageId) => packageId && /^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+$/.test(packageId)) as string[])]
}

export function parseLauncherPackages(value: string): Set<string> {
  const result = new Set<string>()
  for (const line of lines(value)) {
    const match = line.match(/(?:^|\s)([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)\/[a-zA-Z0-9_.$]+/)
    if (match) result.add(match[1])
  }
  return result
}

export function mergeInstalledApps(userOutput: string, systemOutput: string, launcherOutput: string): InstalledApp[] {
  const user = new Set(parsePackageIds(userOutput))
  const system = new Set(parsePackageIds(systemOutput))
  const launchable = parseLauncherPackages(launcherOutput)
  return [...new Set([...user, ...system])]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 10_000)
    .map((packageId) => ({ packageId, label: packageId, system: system.has(packageId), launchable: launchable.has(packageId) }))
}

export function parseGetprop(value: string): Record<string, string> {
  const properties: Record<string, string> = {}
  for (const line of lines(value)) {
    const match = line.match(/^\[([^\]]+)\]: \[(.*)\]$/)
    if (match) properties[match[1]] = match[2]
  }
  return properties
}

export function parseDisplaySize(value: string): string {
  return value.match(/(?:Physical|Override) size:\s*(\d+x\d+)/i)?.[1] || value.match(/\b(\d+x\d+)\b/)?.[1] || ''
}

export function parseBatteryLevel(value: string): number | undefined {
  const level = Number(value.match(/^\s*level:\s*(\d+)\s*$/mi)?.[1])
  return Number.isInteger(level) && level >= 0 && level <= 100 ? level : undefined
}

export function validateRemoteDirectory(value: string): string {
  const target = value.trim()
  if (!target.startsWith('/') || target.length > 1_024 || /[\0\r\n\\]/.test(target)) {
    throw new TypeError('Remote target must be an absolute Android path of at most 1024 characters.')
  }
  if (target.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new TypeError('Remote target may not contain dot path segments.')
  }
  return target === '/' ? '/' : `${target.replace(/\/+$/, '')}/`
}

export function validatePackageId(value: string): string {
  const packageId = value.trim()
  if (packageId.length > 255 || !/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+$/.test(packageId)) {
    throw new TypeError('Android package id is invalid.')
  }
  return packageId
}

export function validateRemoteFileName(value: string): string {
  if (!value || value.length > 255 || value === '.' || value === '..' || /[\0\r\n/\\]/.test(value)) {
    throw new TypeError('Selected filename cannot be represented safely on the Android target.')
  }
  return value
}

async function mapLimit<T, R>(values: T[], concurrency: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex++
      results[index] = await mapper(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()))
  return results
}

export class DeviceWorkspaceService {
  private readonly appCache = new Map<string, InstalledApp[]>()

  constructor(private readonly adb: AdbClient = adbService, private readonly now = () => new Date()) {}

  async overview(runtime: RuntimeConfig, serial: string): Promise<DeviceOverview> {
    const [propertiesResult, displayResult, batteryResult] = await Promise.all([
      this.adb.runForDevice(runtime, serial, ['shell', 'getprop']),
      this.adb.runForDevice(runtime, serial, ['shell', 'wm', 'size']),
      this.adb.runForDevice(runtime, serial, ['shell', 'dumpsys', 'battery'])
    ])
    const properties = parseGetprop(propertiesResult.stdout)
    return {
      serial,
      manufacturer: properties['ro.product.manufacturer'] || '',
      model: properties['ro.product.model'] || '',
      androidVersion: properties['ro.build.version.release'] || '',
      sdk: properties['ro.build.version.sdk'] || '',
      abi: properties['ro.product.cpu.abi'] || '',
      displaySize: parseDisplaySize(output(displayResult.stdout, displayResult.stderr)),
      batteryLevel: parseBatteryLevel(output(batteryResult.stdout, batteryResult.stderr))
    }
  }

  async listApps(runtime: RuntimeConfig, serial: string, refresh = false): Promise<InstalledApp[]> {
    if (!refresh) {
      const cached = this.appCache.get(serial)
      if (cached) return structuredClone(cached)
    }
    const [userResult, systemResult, launcherResult] = await Promise.all([
      this.adb.runForDevice(runtime, serial, ['shell', 'pm', 'list', 'packages', '-3']),
      this.adb.runForDevice(runtime, serial, ['shell', 'pm', 'list', 'packages', '-s']),
      this.adb.runForDevice(runtime, serial, ['shell', 'cmd', 'package', 'query-activities', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER'])
        .catch(() => ({ stdout: '', stderr: '' }))
    ])
    const apps = mergeInstalledApps(userResult.stdout, systemResult.stdout, launcherResult.stdout)
    this.appCache.set(serial, apps)
    return structuredClone(apps)
  }

  async startApp(runtime: RuntimeConfig, serial: string, packageId: string): Promise<string> {
    const safePackageId = validatePackageId(packageId)
    const result = await this.adb.runForDevice(runtime, serial, [
      'shell', 'monkey', '-p', safePackageId, '-c', 'android.intent.category.LAUNCHER', '1'
    ])
    const message = output(result.stdout, result.stderr)
    if (/no activities found|monkey aborted|error:/i.test(message)) throw new Error(message || 'No launchable activity was found.')
    return message || `Started ${safePackageId}.`
  }

  async pushFiles(
    runtime: RuntimeConfig,
    serials: string[],
    files: SelectedLocalFile[],
    target: string,
    conflict: FileConflictPolicy,
    onProgress?: BatchProgressListener
  ): Promise<BatchOperationResult<FileTransferResult>> {
    const id = randomUUID()
    const startedAt = this.now().toISOString()
    const directory = validateRemoteDirectory(target)
    const tasks = serials.flatMap((serial) => files.map((file) => ({
      serial,
      file: { ...file, name: validateRemoteFileName(file.name) }
    })))
    const names = new Set(tasks.filter((task) => task.serial === serials[0]).map((task) => task.file.name))
    if (names.size !== files.length) throw new TypeError('Selected files must have unique target filenames.')
    const results = await mapLimit(tasks, 2, async ({ serial, file }): Promise<BatchItemResult<FileTransferResult>> => {
      const targetPath = posix.join(directory, file.name)
      const targetId = `${serial}:${file.name}`
      onProgress?.({ batchId: id, kind: 'file-push', deviceId: serial, targetId, status: 'running', timestamp: this.now().toISOString(), message: `Pushing ${file.name}.`, size: file.size })
      try {
        if (conflict === 'skip' && await this.remoteExists(runtime, serial, targetPath)) {
          const result: BatchItemResult<FileTransferResult> = {
            targetId,
            ok: true,
            data: { serial, sourceName: file.name, size: file.size, targetPath, skipped: true, output: 'Skipped because the target already exists.' }
          }
          onProgress?.({ batchId: id, kind: 'file-push', deviceId: serial, targetId, status: 'skipped', timestamp: this.now().toISOString(), message: result.data!.output, size: file.size })
          return result
        }
        const result = await this.adb.runForDevice(runtime, serial, ['push', file.path, targetPath], { timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 })
        const item: BatchItemResult<FileTransferResult> = {
          targetId,
          ok: true,
          data: { serial, sourceName: file.name, size: file.size, targetPath, skipped: false, output: redactSourcePath(output(result.stdout, result.stderr), file.path, file.name) }
        }
        onProgress?.({ batchId: id, kind: 'file-push', deviceId: serial, targetId, status: 'success', timestamp: this.now().toISOString(), message: item.data!.output || 'File pushed.', size: file.size })
        return item
      } catch (error) {
        const item: BatchItemResult<FileTransferResult> = {
          targetId,
          ok: false,
          error: structuredErrorFromUnknown(error, 'FILE_PUSH_FAILED', 'file-push', `Unable to push ${file.name} to ${serial}.`, {
            retryable: true,
            suggestedActions: ['Confirm that the device is connected and the target directory is writable.']
          })
        }
        if (item.error?.detail) item.error.detail = redactSourcePath(item.error.detail, file.path, file.name)
        onProgress?.({ batchId: id, kind: 'file-push', deviceId: serial, targetId, status: 'failed', timestamp: this.now().toISOString(), message: item.error!.message, size: file.size })
        return item
      }
    })
    return { id, startedAt, completedAt: this.now().toISOString(), results }
  }

  async installApk(
    runtime: RuntimeConfig,
    serials: string[],
    file: SelectedLocalFile,
    replace: boolean,
    downgrade: boolean,
    onProgress?: BatchProgressListener
  ): Promise<BatchOperationResult<ApkInstallResult>> {
    const id = randomUUID()
    const startedAt = this.now().toISOString()
    const results = await mapLimit(serials, 2, async (serial): Promise<BatchItemResult<ApkInstallResult>> => {
      onProgress?.({ batchId: id, kind: 'apk-install', deviceId: serial, targetId: serial, status: 'running', timestamp: this.now().toISOString(), message: `Installing ${file.name}.`, size: file.size })
      try {
        const args = ['install', ...(replace ? ['-r'] : []), ...(downgrade ? ['-d'] : []), file.path]
        const result = await this.adb.runForDevice(runtime, serial, args, { timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 })
        const message = redactSourcePath(output(result.stdout, result.stderr), file.path, file.name)
        if (!/^success\b/im.test(message)) throw new Error(message || 'Android package manager did not report success.')
        const item: BatchItemResult<ApkInstallResult> = {
          targetId: serial,
          ok: true,
          data: { serial, sourceName: file.name, size: file.size, replace, downgrade, output: message }
        }
        onProgress?.({ batchId: id, kind: 'apk-install', deviceId: serial, targetId: serial, status: 'success', timestamp: this.now().toISOString(), message, size: file.size })
        return item
      } catch (error) {
        const item: BatchItemResult<ApkInstallResult> = {
          targetId: serial,
          ok: false,
          error: structuredErrorFromUnknown(error, 'APK_INSTALL_FAILED', 'apk-install', `Unable to install ${file.name} on ${serial}.`, {
            retryable: true,
            suggestedActions: ['Review the package-manager detail for signature, version, or storage errors.']
          })
        }
        if (item.error?.detail) item.error.detail = redactSourcePath(item.error.detail, file.path, file.name)
        onProgress?.({ batchId: id, kind: 'apk-install', deviceId: serial, targetId: serial, status: 'failed', timestamp: this.now().toISOString(), message: item.error!.message, size: file.size })
        return item
      }
    })
    return { id, startedAt, completedAt: this.now().toISOString(), results }
  }

  private async remoteExists(runtime: RuntimeConfig, serial: string, path: string): Promise<boolean> {
    try {
      await this.adb.runForDevice(runtime, serial, ['shell', 'ls', '-d', path])
      return true
    } catch {
      return false
    }
  }
}

export const deviceWorkspaceService = new DeviceWorkspaceService()

import { describe, expect, it } from 'vitest'
import type { BatchProgressEvent, RuntimeConfig } from '../src/shared/types'
import type { AdbClient, AdbRunOptions } from '../src/main/adbService'
import type { CommandOutput } from '../src/main/runtime'
import {
  DeviceWorkspaceService,
  mergeInstalledApps,
  parseBatteryLevel,
  parseDisplaySize,
  parseGetprop,
  parseLauncherPackages,
  parsePackageIds,
  validatePackageId,
  validateRemoteDirectory,
  validateRemoteFileName
} from '../src/main/deviceWorkspaceService'

const runtime: RuntimeConfig = { scrcpyPath: '' }

class FakeAdb implements AdbClient {
  readonly calls: Array<{ serial?: string; args: string[] }> = []

  constructor(private readonly respond: (serial: string | undefined, args: string[]) => Promise<CommandOutput>) {}

  run(_runtime: RuntimeConfig, args: string[], _options?: AdbRunOptions): Promise<CommandOutput> {
    this.calls.push({ args })
    return this.respond(undefined, args)
  }

  runForDevice(_runtime: RuntimeConfig, serial: string, args: string[], _options?: AdbRunOptions): Promise<CommandOutput> {
    this.calls.push({ serial, args })
    return this.respond(serial, args)
  }
}

describe('device workspace parsers', () => {
  it('parses and merges package snapshots without duplicates', () => {
    expect(parsePackageIds('package:com.example.one\npackage:/data/base.apk=com.example.two\npackage:com.example.one')).toEqual([
      'com.example.one', 'com.example.two'
    ])
    expect([...parseLauncherPackages('com.example.one/.MainActivity\npriority=0 com.system.app/com.system.app.Home')]).toEqual([
      'com.example.one', 'com.system.app'
    ])
    expect(mergeInstalledApps(
      'package:com.example.one\npackage:com.shared',
      'package:com.system.app\npackage:com.shared',
      'com.example.one/.Main\ncom.system.app/.Home'
    )).toEqual([
      { packageId: 'com.example.one', label: 'com.example.one', system: false, launchable: true },
      { packageId: 'com.shared', label: 'com.shared', system: true, launchable: false },
      { packageId: 'com.system.app', label: 'com.system.app', system: true, launchable: true }
    ])
  })

  it('parses read-only overview probes', () => {
    expect(parseGetprop('[ro.product.model]: [Pixel Test]\n[ro.build.version.sdk]: [36]')).toEqual({
      'ro.product.model': 'Pixel Test', 'ro.build.version.sdk': '36'
    })
    expect(parseDisplaySize('Physical size: 1080x2400\nOverride size: 720x1600')).toBe('1080x2400')
    expect(parseBatteryLevel('  level: 87\n  scale: 100')).toBe(87)
    expect(parseBatteryLevel('level: 101')).toBeUndefined()
  })

  it('rejects unsafe remote directories and package ids', () => {
    expect(validateRemoteDirectory('/sdcard/Download')).toBe('/sdcard/Download/')
    expect(() => validateRemoteDirectory('sdcard/Download')).toThrow('absolute Android path')
    expect(() => validateRemoteDirectory('/sdcard/../data')).toThrow('dot path segments')
    expect(validatePackageId('com.example.app')).toBe('com.example.app')
    expect(() => validatePackageId('com.example;rm')).toThrow('invalid')
    expect(validateRemoteFileName('报告 2026.txt')).toBe('报告 2026.txt')
    expect(() => validateRemoteFileName('../report.txt')).toThrow('safely')
  })
})

describe('DeviceWorkspaceService', () => {
  it('loads overview fields from bounded read-only probes', async () => {
    const adb = new FakeAdb(async (_serial, args) => {
      const command = args.join(' ')
      if (command === 'shell getprop') return { stdout: '[ro.product.manufacturer]: [Google]\n[ro.product.model]: [Pixel]\n[ro.build.version.release]: [16]\n[ro.build.version.sdk]: [36]\n[ro.product.cpu.abi]: [arm64-v8a]', stderr: '' }
      if (command === 'shell wm size') return { stdout: 'Physical size: 1080x2400', stderr: '' }
      return { stdout: 'level: 64', stderr: '' }
    })
    const service = new DeviceWorkspaceService(adb)
    await expect(service.overview(runtime, 'SERIAL')).resolves.toEqual({
      serial: 'SERIAL', manufacturer: 'Google', model: 'Pixel', androidVersion: '16', sdk: '36',
      abi: 'arm64-v8a', displaySize: '1080x2400', batteryLevel: 64
    })
  })

  it('caches app snapshots until an explicit refresh and starts only valid packages', async () => {
    const adb = new FakeAdb(async (_serial, args) => {
      const command = args.join(' ')
      if (command.includes('packages -3')) return { stdout: 'package:com.example.app', stderr: '' }
      if (command.includes('packages -s')) return { stdout: 'package:com.android.settings', stderr: '' }
      if (command.includes('query-activities')) return { stdout: 'com.example.app/.Main', stderr: '' }
      return { stdout: 'Events injected: 1', stderr: '' }
    })
    const service = new DeviceWorkspaceService(adb)
    expect(await service.listApps(runtime, 'SERIAL')).toHaveLength(2)
    expect(await service.listApps(runtime, 'SERIAL')).toHaveLength(2)
    expect(adb.calls).toHaveLength(3)
    await service.listApps(runtime, 'SERIAL', true)
    expect(adb.calls).toHaveLength(6)
    await expect(service.startApp(runtime, 'SERIAL', 'com.example.app')).resolves.toContain('Events injected')
    await expect(service.startApp(runtime, 'SERIAL', 'com.example;bad')).rejects.toThrow('invalid')
  })

  it('returns ordered per-target file results and preserves partial failure', async () => {
    const adb = new FakeAdb(async (serial, args) => {
      if (args[0] === 'push' && serial === 'FAIL') throw new Error('/local/report.txt: remote permission denied')
      return { stdout: '/local/report.txt: 1 file pushed', stderr: '' }
    })
    const service = new DeviceWorkspaceService(adb, () => new Date('2026-08-15T12:00:00.000Z'))
    const progress: BatchProgressEvent[] = []
    const batch = await service.pushFiles(runtime, ['OK', 'FAIL'], [{ path: '/local/report.txt', name: 'report.txt', size: 12 }], '/sdcard/Download', 'replace', (event) => progress.push(event))

    expect(batch.startedAt).toBe('2026-08-15T12:00:00.000Z')
    expect(batch.results).toHaveLength(2)
    expect(batch.results[0]).toMatchObject({ targetId: 'OK:report.txt', ok: true, data: { targetPath: '/sdcard/Download/report.txt' } })
    expect(batch.results[0].data?.output).toBe('report.txt: 1 file pushed')
    expect(batch.results[1]).toMatchObject({ targetId: 'FAIL:report.txt', ok: false, error: { code: 'FILE_PUSH_FAILED', stage: 'file-push' } })
    expect(batch.results[1].error?.detail).toContain('permission denied')
    expect(batch.results[1].error?.detail).not.toContain('/local/')
    expect(progress.map((event) => `${event.targetId}:${event.status}`)).toEqual([
      'OK:report.txt:running', 'FAIL:report.txt:running', 'OK:report.txt:success', 'FAIL:report.txt:failed'
    ])
  })

  it('implements skip conflict policy without issuing push', async () => {
    const adb = new FakeAdb(async () => ({ stdout: '/sdcard/Download/report.txt', stderr: '' }))
    const service = new DeviceWorkspaceService(adb)
    const batch = await service.pushFiles(runtime, ['SERIAL'], [{ path: '/local/report.txt', name: 'report.txt', size: 12 }], '/sdcard/Download/', 'skip')
    expect(batch.results[0]).toMatchObject({ ok: true, data: { skipped: true } })
    expect(adb.calls.map((call) => call.args[0])).toEqual(['shell'])
  })

  it('installs APKs with explicit options and reports each device independently', async () => {
    const adb = new FakeAdb(async (serial) => {
      if (serial === 'FAIL') throw new Error('/local/app.apk: INSTALL_FAILED_UPDATE_INCOMPATIBLE')
      return { stdout: 'Success', stderr: '' }
    })
    const service = new DeviceWorkspaceService(adb)
    const progress: BatchProgressEvent[] = []
    const batch = await service.installApk(runtime, ['OK', 'FAIL'], { path: '/local/app.apk', name: 'app.apk', size: 42 }, true, true, (event) => progress.push(event))
    expect(adb.calls[0].args).toEqual(['install', '-r', '-d', '/local/app.apk'])
    expect(batch.results[0]).toMatchObject({ ok: true, data: { replace: true, downgrade: true } })
    expect(batch.results[1]).toMatchObject({ ok: false, error: { code: 'APK_INSTALL_FAILED' } })
    expect(batch.results[1].error?.detail).not.toContain('/local/')
    expect(progress.filter((event) => event.status === 'running')).toHaveLength(2)
    expect(progress.some((event) => event.status === 'failed' && event.targetId === 'FAIL')).toBe(true)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { actionConcurrency, BatchAutomationService } from '../src/main/batchAutomationService'
import { AutomationRunner } from '../src/main/automationRunner'
import type { AdbClient } from '../src/main/adbService'
import type { BatchRunEvent, CapabilitySnapshot, Device, RuntimeConfig, ScrcpySession } from '../src/shared/types'
import { defaultLaunchConfig } from '../src/shared/config'

const runtime: RuntimeConfig = { scrcpyPath: '' }
const capabilities: CapabilitySnapshot = {
  flags: [],
  features: { screen: true, camera: true, virtualDisplay: true, recordOnly: true, controlOnly: true, otg: true, v4l2: false, appLaunch: true },
  probes: { encoders: true, displays: true, cameras: true, cameraSizes: true, apps: true }
}

class GeometryAdb implements AdbClient {
  async run(): Promise<{ stdout: string; stderr: string }> { return { stdout: '', stderr: '' } }
  async runForDevice(_runtime: RuntimeConfig, _serial: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    if (args.includes('size')) return { stdout: 'Physical size: 1080x2400', stderr: '' }
    if (args.includes('dumpsys')) return { stdout: 'SurfaceOrientation: 0', stderr: '' }
    return { stdout: '', stderr: '' }
  }
}

function runner(): AutomationRunner {
  return new AutomationRunner({
    adb: new GeometryAdb(), control: async () => ({ ok: true, data: 'sent' }),
    startApp: async () => 'started', screenshot: async () => ({ message: 'saved', artifactId: 'artifact' })
  })
}

function service(devices: Device[], sessions: ScrcpySession[] = []): {
  value: BatchAutomationService
  launch: ReturnType<typeof vi.fn>
} {
  const ids = ['preflight-1', 'run-1', 'preflight-2', 'run-2']
  const launch = vi.fn(async () => ({ ok: true, data: ['session-1'] }))
  return {
    launch,
    value: new BatchAutomationService({
      devices: () => structuredClone(devices), sessions: () => structuredClone(sessions), launch,
      control: async () => ({ ok: true, data: 'sent' }), screenshot: async () => ({ message: 'saved', artifactId: 'artifact' }),
      startApp: async () => 'started',
      pushFiles: async (_runtime, serials, files, target) => ({
        id: 'push', startedAt: '', completedAt: '',
        results: serials.flatMap((serial) => files.map((file) => ({
          targetId: `${serial}:${file.name}`, ok: true,
          data: { serial, sourceName: file.name, size: file.size, targetPath: `${target}/${file.name}`, skipped: false, output: 'pushed' }
        })))
      }),
      installApk: async (_runtime, serials, file, replace, downgrade) => ({
        id: 'install', startedAt: '', completedAt: '', results: serials.map((serial) => ({
          targetId: serial, ok: true,
          data: { serial, sourceName: file.name, size: file.size, replace, downgrade, output: 'Success' }
        }))
      }),
      automationRunner: runner(), now: () => new Date('2026-08-15T12:00:00.000Z'),
      createId: () => ids.shift() || 'extra-id'
    })
  }
}

function finalEvent(value: BatchAutomationService): Promise<BatchRunEvent> {
  return new Promise((resolve) => {
    const unsubscribe = value.subscribe((event) => {
      if (event.report) { unsubscribe(); resolve(event) }
    })
  })
}

describe('BatchAutomationService', () => {
  it('caps requested concurrency by operation class', () => {
    expect(actionConcurrency({ type: 'launch', launches: [] }, 8)).toBe(3)
    expect(actionConcurrency({ type: 'screenshot' }, 8)).toBe(4)
    expect(actionConcurrency({ type: 'control', action: 'home' }, 8)).toBe(8)
    expect(actionConcurrency({ type: 'file-push', target: '/sdcard/', conflict: 'skip' }, 8)).toBe(2)
    expect(actionConcurrency({ type: 'apk-install', replace: true, downgrade: false }, 8)).toBe(2)
  })

  it('reports every target during preflight and keeps skipped devices in the final partial report', async () => {
    const devices: Device[] = [
      { serial: 'OK', state: 'device', model: 'Pixel', product: 'pixel', device: 'pixel', connection: 'usb' },
      { serial: 'OFF', state: 'offline', model: 'Pixel', product: 'pixel', device: 'pixel', connection: 'usb' },
      { serial: 'BUSY', state: 'device', model: 'Pixel', product: 'pixel', device: 'pixel', connection: 'usb' }
    ]
    const sessions: ScrcpySession[] = [{
      id: 'active', serialAtLaunch: 'BUSY', scene: 'screen', state: 'running', args: [], createdAt: '2026-08-15T11:00:00.000Z'
    }]
    const { value, launch } = service(devices, sessions)
    const launchConfig = defaultLaunchConfig()
    const preflight = await value.preflight(runtime, {
      serials: ['OK', 'OFF', 'BUSY'], concurrencyLimit: 2,
      action: { type: 'launch', launches: ['OK', 'OFF', 'BUSY'].map((serial) => ({ serial, launch: launchConfig })) }
    }, capabilities)

    expect(preflight.items.map((item) => [item.serial, item.eligible])).toEqual([
      ['OK', true], ['OFF', false], ['BUSY', false]
    ])
    expect(preflight.items[2].sessionConflict).toBe(true)
    expect(value.start(runtime, preflight.token, false, false)).toMatchObject({ ok: false, error: { code: 'BATCH_PREFLIGHT_FAILED' } })

    const finished = finalEvent(value)
    expect(value.start(runtime, preflight.token, true, false)).toEqual({ ok: true, data: 'run-1' })
    const event = await finished
    expect(launch).toHaveBeenCalledTimes(1)
    expect(event.report).toMatchObject({ state: 'partial', canceled: false })
    expect(event.report?.results).toHaveLength(3)
    expect(event.report?.results.filter((item) => item.ok)).toHaveLength(1)
    expect(event.report?.results.filter((item) => item.error?.code === 'BATCH_TARGET_SKIPPED')).toHaveLength(2)
  })

  it('requires explicit confirmation for normalized input and supports canceling an active run', async () => {
    const devices: Device[] = [{ serial: 'OK', state: 'device', model: 'Pixel', product: 'pixel', device: 'pixel', connection: 'usb' }]
    const { value } = service(devices)
    const automation = {
      id: 'macro', name: 'Input', description: '', schemaVersion: 2 as const,
      design: { orientation: 'portrait' as const, aspectRatio: 0 },
      steps: [{ type: 'delay' as const, durationMs: 10_000 }, { type: 'tap' as const, x: 0.5, y: 0.5, coordinateSpace: 'normalized' as const }]
    }
    const preflight = await value.preflight(runtime, {
      serials: ['OK'], concurrencyLimit: 1, action: { type: 'automation', automation }
    }, capabilities)
    expect(preflight.confirmationRequired).toBe(true)
    expect(value.start(runtime, preflight.token, true, false)).toMatchObject({ ok: false, error: { code: 'BATCH_CONFIRMATION_REQUIRED' } })

    const finished = finalEvent(value)
    expect(value.start(runtime, preflight.token, true, true)).toEqual({ ok: true, data: 'run-1' })
    expect(value.cancel('run-1')).toEqual({ ok: true })
    const event = await finished
    expect(event.report).toMatchObject({ state: 'canceled', canceled: true })
    expect(event.report?.results[0]).toMatchObject({ ok: false, error: { code: 'BATCH_TARGET_CANCELED' } })
  })

  it('freezes main-process file selections and confirms overwrite batches', async () => {
    const devices: Device[] = [{ serial: 'OK', state: 'device', model: 'Pixel', product: 'pixel', device: 'pixel', connection: 'usb' }]
    const { value } = service(devices)
    const request = {
      serials: ['OK'], concurrencyLimit: 1,
      action: { type: 'file-push' as const, target: '/sdcard/Download/', conflict: 'replace' as const }
    }
    await expect(value.preflight(runtime, request, capabilities)).rejects.toThrow('selected local files')
    const preflight = await value.preflight(runtime, request, capabilities, {
      kind: 'file-push', files: [{ path: '/local/report.txt', name: 'report.txt', size: 12 }]
    })
    expect(preflight).toMatchObject({ confirmationRequired: true, confirmationKind: 'overwrite' })
    const finished = finalEvent(value)
    expect(value.start(runtime, preflight.token, true, true)).toEqual({ ok: true, data: 'run-1' })
    expect((await finished).report?.results[0]).toMatchObject({ ok: true, data: { actionType: 'file-push' } })
  })
})

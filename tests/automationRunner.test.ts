import { describe, expect, it, vi } from 'vitest'
import type { AdbClient, AdbRunOptions } from '../src/main/adbService'
import { AutomationRunner, parseDeviceGeometry } from '../src/main/automationRunner'
import type { AutomationStep, BatchRunEvent, RuntimeConfig } from '../src/shared/types'

const runtime: RuntimeConfig = { scrcpyPath: '' }

class FakeAdb implements AdbClient {
  calls: string[][] = []

  run(_runtime: RuntimeConfig, args: string[], _options?: AdbRunOptions): Promise<{ stdout: string; stderr: string }> {
    this.calls.push(args)
    if (args.includes('size')) return Promise.resolve({ stdout: 'Physical size: 1080x2400', stderr: '' })
    if (args.includes('input') && args.includes('dumpsys')) return Promise.resolve({ stdout: 'SurfaceOrientation: 1', stderr: '' })
    return Promise.resolve({ stdout: '', stderr: '' })
  }

  runForDevice(runtimeValue: RuntimeConfig, serial: string, args: string[], options?: AdbRunOptions): Promise<{ stdout: string; stderr: string }> {
    return this.run(runtimeValue, ['-s', serial, ...args], options)
  }
}

describe('AutomationRunner', () => {
  it('maps normalized input to current device geometry and emits bounded step events', async () => {
    const adb = new FakeAdb()
    const events: BatchRunEvent[] = []
    const control = vi.fn(async () => ({ ok: true, data: 'home sent' }))
    const startApp = vi.fn(async () => 'started')
    const screenshot = vi.fn(async () => ({ message: 'saved', artifactId: 'artifact-1' }))
    const runner = new AutomationRunner({ adb, control, startApp, screenshot })
    const steps: AutomationStep[] = [
      { type: 'control', action: 'home' },
      { type: 'tap', x: 0.5, y: 0.25, coordinateSpace: 'normalized' },
      { type: 'swipe', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, durationMs: 300, coordinateSpace: 'normalized' },
      { type: 'text', value: 'hello world', sensitive: false },
      { type: 'start-app', packageId: 'com.example.app' },
      { type: 'screenshot', label: 'after' },
      { type: 'assert-device', condition: { type: 'orientation', value: 'landscape' } }
    ]
    const result = await runner.run(runtime, 'SERIAL', steps, {
      runId: 'run-1', signal: new AbortController().signal, onEvent: (event) => events.push(event)
    })

    expect(result.completedSteps).toBe(7)
    expect(adb.calls).toContainEqual(['-s', 'SERIAL', 'shell', 'input', 'tap', '1200', '270'])
    expect(adb.calls).toContainEqual(['-s', 'SERIAL', 'shell', 'input', 'swipe', '0', '0', '2399', '1079', '300'])
    expect(adb.calls).toContainEqual(['-s', 'SERIAL', 'shell', 'input', 'text', 'hello%sworld'])
    expect(control).toHaveBeenCalledWith(runtime, 'SERIAL', 'home')
    expect(startApp).toHaveBeenCalledWith(runtime, 'SERIAL', 'com.example.app')
    expect(screenshot).toHaveBeenCalledWith(runtime, 'SERIAL', 'after')
    expect(events.filter((event) => event.status === 'step-start')).toHaveLength(7)
    expect(events.filter((event) => event.status === 'step-success')).toHaveLength(7)
    expect(events.some((event) => event.message.includes('hello world'))).toBe(false)
  })

  it('stops during a delay and never schedules the following step', async () => {
    const adb = new FakeAdb()
    const control = vi.fn(async () => ({ ok: true, data: 'sent' }))
    const controller = new AbortController()
    const runner = new AutomationRunner({ adb, control, startApp: async () => '', screenshot: async () => ({ message: '' }) })
    const execution = runner.run(runtime, 'SERIAL', [
      { type: 'delay', durationMs: 10_000 },
      { type: 'control', action: 'home' }
    ], { runId: 'run-2', signal: controller.signal })
    controller.abort()
    await expect(execution).rejects.toMatchObject({ name: 'AbortError' })
    expect(control).not.toHaveBeenCalled()
  })

  it('rejects geometry assertions instead of blindly applying coordinates', async () => {
    const runner = new AutomationRunner({
      adb: new FakeAdb(), control: async () => ({ ok: true }), startApp: async () => '', screenshot: async () => ({ message: '' })
    })
    await expect(runner.run(runtime, 'SERIAL', [
      { type: 'assert-device', condition: { type: 'orientation', value: 'portrait' } }
    ], { runId: 'run-3', signal: new AbortController().signal })).rejects.toThrow('expected portrait')
  })
})

describe('parseDeviceGeometry', () => {
  it('applies the current surface rotation before reporting orientation', () => {
    expect(parseDeviceGeometry('Physical size: 1080x2400', 'SurfaceOrientation: 1')).toEqual({
      width: 2400, height: 1080, orientation: 'landscape', aspectRatio: 2400 / 1080
    })
  })
})

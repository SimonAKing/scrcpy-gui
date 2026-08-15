import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import type {
  AutomationStep,
  Device,
  DeviceControlAction,
  DeviceLaunch,
  DeviceTrackerEvent,
  EnvironmentStatus,
  OperationResult,
  RuntimeConfig,
  ScrcpySession,
  ScrcpySessionEvent,
  SessionStopReason
} from '../shared/types'
import { buildScrcpyArgs, isSupportedScrcpyVersion, parseAdbDevices, prepareLaunchConfig, validateDeviceAddress } from './scrcpy'
import { ScrcpySessionManager } from './sessionManager'
import { buildCapabilitySnapshot } from './capabilities'
import { DeviceTracker } from './deviceTracker'
import { failureFromUnknown, operationFailure, operationErrorMessage } from '../shared/errors'
import { adbService } from './adbService'
import { executeCommand, resolveBinary, type CommandOutput } from './runtime'

const sessionManager = new ScrcpySessionManager()
let trackerRuntime: RuntimeConfig = { scrcpyPath: '' }
const deviceTracker = new DeviceTracker({
  pollDevices: async () => {
    const result = await listDevices(trackerRuntime)
    if (!result.ok) throw new Error(operationErrorMessage(result, 'Unable to poll ADB devices.'))
    return result.data || []
  }
})
const CONTROL_KEYCODES: Partial<Record<DeviceControlAction, string>> = {
  back: 'KEYCODE_BACK',
  home: 'KEYCODE_HOME',
  'app-switch': 'KEYCODE_APP_SWITCH',
  menu: 'KEYCODE_MENU',
  'volume-up': 'KEYCODE_VOLUME_UP',
  'volume-down': 'KEYCODE_VOLUME_DOWN',
  power: 'KEYCODE_POWER',
  'screen-on': 'KEYCODE_WAKEUP',
  'screen-off': 'KEYCODE_SLEEP'
}
const SPECIAL_CONTROL_ACTIONS = new Set<DeviceControlAction>([
  'rotate',
  'auto-rotate',
  'screen-on',
  'screen-off',
  'show-touches-on',
  'show-touches-off'
])

function firstVersionLine(output: string, prefix: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.toLowerCase().startsWith(prefix)) || output.trim().split(/\r?\n/)[0] || ''
}

export async function getEnvironment(runtime: RuntimeConfig): Promise<EnvironmentStatus> {
  const scrcpyPath = await resolveBinary(runtime, 'scrcpy')
  const adbPath = await resolveBinary(runtime, 'adb')
  const status: EnvironmentStatus = {
    scrcpy: { ok: false, path: scrcpyPath, version: '', error: '' },
    adb: { ok: false, path: adbPath, version: '', error: '' }
  }

  if (!scrcpyPath) {
    status.scrcpy.error = 'scrcpy executable not found. Choose it in Runtime setup or add it to PATH.'
  } else {
    try {
      const result = await executeCommand(scrcpyPath, ['--version'])
      status.scrcpy.version = firstVersionLine(`${result.stdout}\n${result.stderr}`, 'scrcpy')
      status.scrcpy.ok = isSupportedScrcpyVersion(status.scrcpy.version)
      if (!status.scrcpy.ok) {
        status.scrcpy.error = `scrcpy 4.x or newer is required; found ${status.scrcpy.version || 'an unknown version'}.`
      } else {
        try {
          const help = await executeCommand(scrcpyPath, ['--help'])
          status.scrcpy.capabilities = buildCapabilitySnapshot(`${help.stdout}\n${help.stderr}`)
        } catch (error) {
          status.scrcpy.capabilities = buildCapabilitySnapshot('')
          status.scrcpy.capabilityError = error instanceof Error ? error.message : String(error)
        }
      }
    } catch (error) {
      status.scrcpy.error = error instanceof Error ? error.message : String(error)
    }
  }

  if (!adbPath) {
    status.adb.error = 'adb executable not found. Install Android platform-tools or use a scrcpy bundle containing adb.'
  } else {
    try {
      const result = await executeCommand(adbPath, ['version'])
      status.adb.ok = true
      status.adb.version = firstVersionLine(`${result.stdout}\n${result.stderr}`, 'android debug bridge')
    } catch (error) {
      status.adb.error = error instanceof Error ? error.message : String(error)
    }
  }

  return status
}

async function adbCommand(runtime: RuntimeConfig, args: string[]): Promise<CommandOutput> {
  return adbService.run(runtime, args)
}

function executeBinary(file: string, args: string[], timeout = 20_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, env: { ...process.env, LANG: 'en_US.UTF-8' } })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let size = 0
    let settled = false
    const timer = setTimeout(() => {
      child.kill()
      if (!settled) {
        settled = true
        reject(new Error('adb screenshot timed out.'))
      }
    }, timeout)

    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 64 * 1024 * 1024) {
        child.kill()
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(new Error('Device screenshot exceeded the 64 MB safety limit.'))
        }
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        reject(error)
      }
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString().trim() || `adb exited with code ${code ?? 'unknown'}.`))
        return
      }
      resolve(Buffer.concat(stdout))
    })
  })
}

export async function listDevices(runtime: RuntimeConfig): Promise<OperationResult<Device[]>> {
  try {
    const result = await adbCommand(runtime, ['devices', '-l'])
    return { ok: true, data: parseAdbDevices(result.stdout) }
  } catch (error) {
    return failureFromUnknown(error, 'ADB_LIST_FAILED', 'device-list', 'Unable to list Android devices.', {
      retryable: true,
      suggestedActions: ['Recheck the runtime setup.', 'Reconnect the device and try again.']
    })
  }
}

export async function startDeviceTracker(runtime: RuntimeConfig): Promise<OperationResult<Device[]>> {
  trackerRuntime = runtime
  const adbPath = await resolveBinary(runtime, 'adb')
  if (!adbPath) return operationFailure('ADB_NOT_FOUND', 'device-tracker', 'adb executable not found.', {
    suggestedActions: ['Recheck the runtime setup.']
  })
  try {
    return { ok: true, data: deviceTracker.start(adbPath) }
  } catch (error) {
    return failureFromUnknown(error, 'DEVICE_TRACKER_START_FAILED', 'device-tracker', 'Unable to start device tracking.', {
      retryable: true,
      suggestedActions: ['Recheck the runtime setup.', 'Try refreshing devices manually.']
    })
  }
}

export function subscribeDeviceTrackerEvents(listener: (event: DeviceTrackerEvent) => void): () => void {
  return deviceTracker.subscribe(listener)
}

export function setDeviceTrackerVisibility(visible: boolean): void {
  deviceTracker.setVisible(visible)
}

export function stopDeviceTracker(): void {
  deviceTracker.stop()
}

export function listTrackedDevices(): Device[] {
  return deviceTracker.snapshot()
}

export async function stopAdbServer(runtime: RuntimeConfig): Promise<void> {
  try {
    await adbCommand(runtime, ['kill-server'])
  } catch {
    // Quitting must not be blocked if adb is already unavailable.
  }
}

export async function connectDevice(runtime: RuntimeConfig, target: string): Promise<OperationResult<string>> {
  const address = target.trim()
  if (!validateDeviceAddress(address)) {
    return operationFailure('INVALID_DEVICE_ADDRESS', 'validation', 'Enter a valid host and optional port (1-65535).')
  }
  try {
    const result = await adbCommand(runtime, ['connect', address])
    const output = `${result.stdout}\n${result.stderr}`.trim()
    const ok = /connected to|already connected to/i.test(output)
    return ok ? { ok: true, data: output } : operationFailure('ADB_CONNECT_FAILED', 'device-connect', 'adb connect failed.', {
      detail: output || undefined,
      retryable: true,
      suggestedActions: ['Confirm wireless debugging is enabled.', 'Verify that the host and port are reachable.']
    })
  } catch (error) {
    return failureFromUnknown(error, 'ADB_CONNECT_FAILED', 'device-connect', 'Unable to connect to the device.', {
      retryable: true,
      suggestedActions: ['Confirm wireless debugging is enabled.', 'Verify that the host and port are reachable.']
    })
  }
}

export async function pairDevice(
  runtime: RuntimeConfig,
  target: string,
  code: string
): Promise<OperationResult<string>> {
  const address = target.trim()
  if (!validateDeviceAddress(address, true)) {
    return operationFailure('INVALID_PAIR_ADDRESS', 'validation', 'Pairing requires a valid host:port.')
  }
  if (!/^\d{6}$/.test(code.trim())) {
    return operationFailure('INVALID_PAIRING_CODE', 'validation', 'Pairing code must contain exactly six digits.')
  }
  try {
    const result = await adbCommand(runtime, ['pair', address, code.trim()])
    const output = `${result.stdout}\n${result.stderr}`.trim()
    const ok = /successfully paired/i.test(output)
    return ok ? { ok: true, data: output } : operationFailure('ADB_PAIR_FAILED', 'device-pair', 'adb pair failed.', {
      detail: output || undefined,
      retryable: true,
      suggestedActions: ['Request a new pairing code.', 'Verify that the pairing host and port are correct.']
    })
  } catch (error) {
    return failureFromUnknown(error, 'ADB_PAIR_FAILED', 'device-pair', 'Unable to pair the device.', {
      retryable: true,
      suggestedActions: ['Request a new pairing code.', 'Verify that the pairing host and port are correct.']
    })
  }
}

export async function disconnectDevice(runtime: RuntimeConfig, target: string): Promise<OperationResult<string>> {
  const address = target.trim()
  if (!validateDeviceAddress(address)) {
    return operationFailure('INVALID_DEVICE_ADDRESS', 'validation', 'Enter a valid wireless device address.')
  }
  try {
    const result = await adbCommand(runtime, ['disconnect', address])
    const output = `${result.stdout}\n${result.stderr}`.trim()
    return { ok: true, data: output }
  } catch (error) {
    return failureFromUnknown(error, 'ADB_DISCONNECT_FAILED', 'device-disconnect', 'Unable to disconnect the device.', {
      retryable: true,
      suggestedActions: ['Refresh the device list and try again.']
    })
  }
}

async function rotateDevice(runtime: RuntimeConfig, serial: string): Promise<string> {
  const state = await adbCommand(runtime, ['-s', serial, 'shell', 'dumpsys', 'input'])
  const output = `${state.stdout}\n${state.stderr}`
  const match = output.match(/SurfaceOrientation:\s*([0-3])/i) || output.match(/orientation=([0-3])/i)
  const next = ((match ? Number(match[1]) : 0) + 1) % 4
  try {
    await adbCommand(runtime, ['-s', serial, 'shell', 'wm', 'user-rotation', 'lock', String(next)])
  } catch {
    await adbCommand(runtime, ['-s', serial, 'shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0'])
    await adbCommand(runtime, ['-s', serial, 'shell', 'settings', 'put', 'system', 'user_rotation', String(next)])
  }
  return `Device rotated to orientation ${next}.`
}

export async function controlDevice(
  runtime: RuntimeConfig,
  serial: string,
  action: DeviceControlAction
): Promise<OperationResult<string>> {
  const target = serial.trim()
  if (!target) return operationFailure('DEVICE_REQUIRED', 'validation', 'Choose a device first.')
  try {
    if (action === 'rotate') return { ok: true, data: await rotateDevice(runtime, target) }
    if (action === 'auto-rotate') {
      try {
        await adbCommand(runtime, ['-s', target, 'shell', 'wm', 'user-rotation', 'free'])
      } catch {
        await adbCommand(runtime, ['-s', target, 'shell', 'settings', 'put', 'system', 'accelerometer_rotation', '1'])
      }
      return { ok: true, data: `Automatic rotation restored on ${target}.` }
    }
    if (action === 'show-touches-on' || action === 'show-touches-off') {
      await adbCommand(runtime, ['-s', target, 'shell', 'settings', 'put', 'system', 'show_touches', action === 'show-touches-on' ? '1' : '0'])
      return { ok: true, data: `${action} sent to ${target}.` }
    }
    const keyCode = CONTROL_KEYCODES[action]
    if (!keyCode) return operationFailure('UNSUPPORTED_CONTROL_ACTION', 'validation', 'Unsupported device control action.')
    if (action === 'screen-on' || action === 'screen-off') {
      try {
        await adbCommand(runtime, ['-s', target, 'shell', 'cmd', 'display', action === 'screen-on' ? 'power-on' : 'power-off', '0'])
        return { ok: true, data: `${action} sent to ${target}.` }
      } catch {
        // Older Android versions do not expose cmd display power controls.
      }
    }
    await adbCommand(runtime, ['-s', target, 'shell', 'input', 'keyevent', keyCode])
    return { ok: true, data: `${action} sent to ${target}.` }
  } catch (error) {
    return failureFromUnknown(error, 'DEVICE_CONTROL_FAILED', 'device-control', 'Unable to control the device.', {
      retryable: true,
      suggestedActions: ['Confirm that the device is still connected and authorized.']
    })
  }
}

export async function captureDeviceScreenshot(
  runtime: RuntimeConfig,
  serial: string,
  outputPath: string
): Promise<OperationResult<string>> {
  try {
    const adbPath = await resolveBinary(runtime, 'adb')
    if (!adbPath) return operationFailure('ADB_NOT_FOUND', 'screenshot', 'adb executable not found.', {
      suggestedActions: ['Recheck the runtime setup.']
    })
    const png = await executeBinary(adbPath, ['-s', serial.trim(), 'exec-out', 'screencap', '-p'])
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    if (png.length < signature.length || !png.subarray(0, signature.length).equals(signature)) {
      throw new Error('The device did not return a valid PNG screenshot.')
    }
    await writeFile(outputPath, png)
    return { ok: true, data: outputPath }
  } catch (error) {
    return failureFromUnknown(error, 'SCREENSHOT_FAILED', 'screenshot', 'Unable to capture the screenshot.', {
      retryable: true,
      suggestedActions: ['Confirm that the device is connected and unlocked.']
    })
  }
}

export async function runDeviceAutomation(
  runtime: RuntimeConfig,
  serial: string,
  steps: AutomationStep[]
): Promise<OperationResult<string>> {
  if (!serial.trim()) return operationFailure('DEVICE_REQUIRED', 'validation', 'Choose a device first.')
  if (!Array.isArray(steps) || steps.length === 0) {
    return operationFailure('AUTOMATION_EMPTY', 'validation', 'The automation has no actions.')
  }
  if (steps.length > 200) {
    return operationFailure('AUTOMATION_TOO_LARGE', 'validation', 'An automation may contain at most 200 actions.')
  }
  let totalDelay = 0
  for (const step of steps) {
    if (!CONTROL_KEYCODES[step.action] && !SPECIAL_CONTROL_ACTIONS.has(step.action)) {
      return operationFailure('AUTOMATION_ACTION_UNSUPPORTED', 'validation', 'The automation contains an unsupported action.')
    }
    if (!Number.isFinite(step.delayMs) || step.delayMs < 0 || step.delayMs > 60_000) {
      return operationFailure('AUTOMATION_DELAY_INVALID', 'validation', 'Each automation delay must be between 0 and 60 seconds.')
    }
    totalDelay += step.delayMs
  }
  if (totalDelay > 30 * 60_000) {
    return operationFailure('AUTOMATION_DURATION_EXCEEDED', 'validation', 'Automation duration may not exceed 30 minutes.')
  }

  for (const step of steps) {
    if (step.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, step.delayMs))
    const result = await controlDevice(runtime, serial, step.action)
    if (!result.ok) return result
  }
  return { ok: true, data: `Replayed ${steps.length} actions on ${serial}.` }
}

export function subscribeScrcpySessionEvents(listener: (event: ScrcpySessionEvent) => void): () => void {
  return sessionManager.subscribe(listener)
}

export function listScrcpySessions(): ScrcpySession[] {
  return sessionManager.list()
}

export async function startScrcpy(
  runtime: RuntimeConfig,
  launches: DeviceLaunch[]
): Promise<OperationResult<string[]>> {
  const scrcpyPath = await resolveBinary(runtime, 'scrcpy')
  if (!scrcpyPath) return operationFailure('SCRCPY_NOT_FOUND', 'session-preflight', 'scrcpy executable not found.', {
    suggestedActions: ['Recheck the runtime setup.', 'Choose a scrcpy executable manually.']
  })
  try {
    const result = await executeCommand(scrcpyPath, ['--version'])
    const version = firstVersionLine(`${result.stdout}\n${result.stderr}`, 'scrcpy')
    if (!isSupportedScrcpyVersion(version)) {
      return operationFailure('SCRCPY_UNSUPPORTED', 'session-preflight', `scrcpy 4.x or newer is required; found ${version}.`, {
        suggestedActions: ['Install or choose scrcpy 4.x or newer.']
      })
    }
  } catch (error) {
    return failureFromUnknown(error, 'SCRCPY_PREFLIGHT_FAILED', 'session-preflight', 'Unable to verify the scrcpy runtime.', {
      retryable: true,
      suggestedActions: ['Recheck the runtime setup.']
    })
  }
  const uniqueLaunches = [...new Map(
    launches
      .filter((request) => request && request.serial.trim())
      .map((request) => [request.serial.trim(), { serial: request.serial.trim(), launch: request.launch }])
  ).values()]
  if (uniqueLaunches.length === 0) return operationFailure('DEVICE_REQUIRED', 'validation', 'Select at least one device.')

  const started: string[] = []
  for (const { serial, launch } of uniqueLaunches) {
    let args: string[]
    try {
      args = buildScrcpyArgs(prepareLaunchConfig(launch, serial), serial)
    } catch (error) {
      return failureFromUnknown(error, 'SESSION_OPTIONS_INVALID', 'session-preflight', 'Unable to prepare the scrcpy command.', {
        suggestedActions: ['Review the command preview and expert arguments.']
      })
    }

    const session = sessionManager.launch({ executable: scrcpyPath, serial, scene: launch.scene, args })
    if (session.state !== 'failed') started.push(serial)
  }

  return started.length > 0
    ? { ok: true, data: started }
    : operationFailure('SESSION_START_FAILED', 'session-launch', 'No new scrcpy process was started.', {
      retryable: true,
      suggestedActions: ['Review the Sessions page and structured events for details.']
    })
}

export function stopScrcpy(serial: string): OperationResult {
  return sessionManager.stopBySerial(serial)
}

export function stopScrcpySession(id: string): OperationResult {
  return sessionManager.stop(id)
}

export function stopAllScrcpy(reason: SessionStopReason = 'app-quit'): void {
  sessionManager.stopAll(reason)
}

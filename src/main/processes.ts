import { execFile, spawn } from 'node:child_process'
import { constants as fsConstants, existsSync, statSync } from 'node:fs'
import { access, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { homedir } from 'node:os'
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
import { buildScrcpyArgs, isSupportedScrcpyVersion, parseAdbDevices, validateDeviceAddress } from './scrcpy'
import { ScrcpySessionManager } from './sessionManager'
import { buildCapabilitySnapshot } from './capabilities'
import { DeviceTracker } from './deviceTracker'

interface CommandOutput {
  stdout: string
  stderr: string
}

const sessionManager = new ScrcpySessionManager()
let trackerRuntime: RuntimeConfig = { scrcpyPath: '' }
const deviceTracker = new DeviceTracker({
  pollDevices: async () => {
    const result = await listDevices(trackerRuntime)
    if (!result.ok) throw new Error(result.error || 'Unable to poll ADB devices.')
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

function executableName(binary: 'scrcpy' | 'adb'): string {
  return process.platform === 'win32' ? `${binary}.exe` : binary
}

async function canExecute(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

export async function resolveBinary(runtime: RuntimeConfig, binary: 'scrcpy' | 'adb'): Promise<string> {
  const name = executableName(binary)
  const configured = runtime.scrcpyPath.trim()
  const candidates: string[] = []

  if (configured && existsSync(configured)) {
    const stats = statSync(configured)
    if (stats.isDirectory()) {
      candidates.push(join(configured, name))
    } else if (binary === 'scrcpy') {
      candidates.push(configured)
    } else {
      candidates.push(join(dirname(configured), name))
    }
  }

  if (process.resourcesPath) candidates.push(join(process.resourcesPath, 'scrcpy', name))

  const pathFolders = (process.env.PATH || process.env.Path || '').split(delimiter).filter(Boolean)
  if (process.platform === 'darwin') pathFolders.push('/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin')
  if (process.platform !== 'win32') pathFolders.push('/usr/local/bin', '/usr/bin')
  if (binary === 'adb') {
    const sdkRoots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean) as string[]
    sdkRoots.push(join(homedir(), 'Library/Android/sdk'), join(homedir(), 'Android/Sdk'))
    for (const root of sdkRoots) candidates.push(join(root, 'platform-tools', name))
  }

  for (const folder of pathFolders) {
    candidates.push(join(folder, name))
  }

  for (const candidate of candidates) {
    if (await canExecute(candidate)) return candidate
  }
  return ''
}

function execute(file: string, args: string[], timeout = 15_000): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, LANG: 'en_US.UTF-8' }
      },
      (error, stdout, stderr) => {
        if (error) {
          const details = String(stderr || stdout || error.message).trim()
          reject(new Error(details))
          return
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) })
      }
    )
  })
}

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
      const result = await execute(scrcpyPath, ['--version'])
      status.scrcpy.version = firstVersionLine(`${result.stdout}\n${result.stderr}`, 'scrcpy')
      status.scrcpy.ok = isSupportedScrcpyVersion(status.scrcpy.version)
      if (!status.scrcpy.ok) {
        status.scrcpy.error = `scrcpy 4.x or newer is required; found ${status.scrcpy.version || 'an unknown version'}.`
      } else {
        try {
          const help = await execute(scrcpyPath, ['--help'])
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
      const result = await execute(adbPath, ['version'])
      status.adb.ok = true
      status.adb.version = firstVersionLine(`${result.stdout}\n${result.stderr}`, 'android debug bridge')
    } catch (error) {
      status.adb.error = error instanceof Error ? error.message : String(error)
    }
  }

  return status
}

async function adbCommand(runtime: RuntimeConfig, args: string[]): Promise<CommandOutput> {
  const adbPath = await resolveBinary(runtime, 'adb')
  if (!adbPath) throw new Error('adb executable not found.')
  return execute(adbPath, args)
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
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function startDeviceTracker(runtime: RuntimeConfig): Promise<OperationResult<Device[]>> {
  trackerRuntime = runtime
  const adbPath = await resolveBinary(runtime, 'adb')
  if (!adbPath) return { ok: false, error: 'adb executable not found.' }
  try {
    return { ok: true, data: deviceTracker.start(adbPath) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
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

export async function stopAdbServer(runtime: RuntimeConfig): Promise<void> {
  try {
    await adbCommand(runtime, ['kill-server'])
  } catch {
    // Quitting must not be blocked if adb is already unavailable.
  }
}

export async function connectDevice(runtime: RuntimeConfig, target: string): Promise<OperationResult<string>> {
  const address = target.trim()
  if (!validateDeviceAddress(address)) return { ok: false, error: 'Enter a valid host and optional port (1-65535).' }
  try {
    const result = await adbCommand(runtime, ['connect', address])
    const output = `${result.stdout}\n${result.stderr}`.trim()
    const ok = /connected to|already connected to/i.test(output)
    return ok ? { ok: true, data: output } : { ok: false, error: output || 'adb connect failed.' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function pairDevice(
  runtime: RuntimeConfig,
  target: string,
  code: string
): Promise<OperationResult<string>> {
  const address = target.trim()
  if (!validateDeviceAddress(address, true)) return { ok: false, error: 'Pairing requires a valid host:port.' }
  if (!/^\d{6}$/.test(code.trim())) return { ok: false, error: 'Pairing code must contain exactly six digits.' }
  try {
    const result = await adbCommand(runtime, ['pair', address, code.trim()])
    const output = `${result.stdout}\n${result.stderr}`.trim()
    const ok = /successfully paired/i.test(output)
    return ok ? { ok: true, data: output } : { ok: false, error: output || 'adb pair failed.' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function disconnectDevice(runtime: RuntimeConfig, target: string): Promise<OperationResult<string>> {
  const address = target.trim()
  if (!validateDeviceAddress(address)) return { ok: false, error: 'Enter a valid wireless device address.' }
  try {
    const result = await adbCommand(runtime, ['disconnect', address])
    const output = `${result.stdout}\n${result.stderr}`.trim()
    return { ok: true, data: output }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
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
  if (!target) return { ok: false, error: 'Choose a device first.' }
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
    if (!keyCode) return { ok: false, error: 'Unsupported device control action.' }
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
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function captureDeviceScreenshot(
  runtime: RuntimeConfig,
  serial: string,
  outputPath: string
): Promise<OperationResult<string>> {
  try {
    const adbPath = await resolveBinary(runtime, 'adb')
    if (!adbPath) return { ok: false, error: 'adb executable not found.' }
    const png = await executeBinary(adbPath, ['-s', serial.trim(), 'exec-out', 'screencap', '-p'])
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    if (png.length < signature.length || !png.subarray(0, signature.length).equals(signature)) {
      throw new Error('The device did not return a valid PNG screenshot.')
    }
    await writeFile(outputPath, png)
    return { ok: true, data: outputPath }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function runDeviceAutomation(
  runtime: RuntimeConfig,
  serial: string,
  steps: AutomationStep[]
): Promise<OperationResult<string>> {
  if (!serial.trim()) return { ok: false, error: 'Choose a device first.' }
  if (!Array.isArray(steps) || steps.length === 0) return { ok: false, error: 'The automation has no actions.' }
  if (steps.length > 200) return { ok: false, error: 'An automation may contain at most 200 actions.' }
  let totalDelay = 0
  for (const step of steps) {
    if (!CONTROL_KEYCODES[step.action] && !SPECIAL_CONTROL_ACTIONS.has(step.action)) {
      return { ok: false, error: 'The automation contains an unsupported action.' }
    }
    if (!Number.isFinite(step.delayMs) || step.delayMs < 0 || step.delayMs > 60_000) {
      return { ok: false, error: 'Each automation delay must be between 0 and 60 seconds.' }
    }
    totalDelay += step.delayMs
  }
  if (totalDelay > 30 * 60_000) return { ok: false, error: 'Automation duration may not exceed 30 minutes.' }

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
  if (!scrcpyPath) return { ok: false, error: 'scrcpy executable not found.' }
  try {
    const result = await execute(scrcpyPath, ['--version'])
    const version = firstVersionLine(`${result.stdout}\n${result.stderr}`, 'scrcpy')
    if (!isSupportedScrcpyVersion(version)) return { ok: false, error: `scrcpy 4.x or newer is required; found ${version}.` }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  const uniqueLaunches = [...new Map(
    launches
      .filter((request) => request && request.serial.trim())
      .map((request) => [request.serial.trim(), { serial: request.serial.trim(), launch: request.launch }])
  ).values()]
  if (uniqueLaunches.length === 0) return { ok: false, error: 'Select at least one device.' }

  const started: string[] = []
  for (const { serial, launch } of uniqueLaunches) {
    let args: string[]
    try {
      let effectiveLaunch = launch
      if (launch.recordEnabled && launch.autoRecordName) {
        if (!launch.recordDirectory.trim()) throw new Error('Choose a recording folder for automatic filenames.')
        const safeSerial = serial.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'device'
        const timestamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19)
        effectiveLaunch = {
          ...launch,
          recordPath: join(launch.recordDirectory.trim(), `scrcpy-${safeSerial}-${timestamp}.mp4`)
        }
      }
      args = buildScrcpyArgs(effectiveLaunch, serial)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }

    const session = sessionManager.launch({ executable: scrcpyPath, serial, scene: 'screen', args })
    if (session.state !== 'failed') started.push(serial)
  }

  return started.length > 0
    ? { ok: true, data: started }
    : { ok: false, error: 'No new scrcpy process was started.' }
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

import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { constants as fsConstants, existsSync, statSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type {
  Device,
  EnvironmentStatus,
  LaunchConfig,
  OperationResult,
  RuntimeConfig,
  ScrcpyStatusEvent
} from '../shared/types'
import { buildScrcpyArgs, isSupportedScrcpyVersion, parseAdbDevices, validateDeviceAddress } from './scrcpy'

type StatusEmitter = (event: ScrcpyStatusEvent) => void

interface CommandOutput {
  stdout: string
  stderr: string
}

const activeProcesses = new Map<string, ChildProcessWithoutNullStreams>()

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
      if (!status.scrcpy.ok) status.scrcpy.error = `scrcpy 4.x or newer is required; found ${status.scrcpy.version || 'an unknown version'}.`
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

export async function listDevices(runtime: RuntimeConfig): Promise<OperationResult<Device[]>> {
  try {
    const result = await adbCommand(runtime, ['devices', '-l'])
    return { ok: true, data: parseAdbDevices(result.stdout) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
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

function emitMessage(emit: StatusEmitter, serial: string, status: ScrcpyStatusEvent['status'], message: string): void {
  emit({ serial, status, message, timestamp: new Date().toISOString() })
}

export async function startScrcpy(
  runtime: RuntimeConfig,
  launch: LaunchConfig,
  serials: string[],
  emit: StatusEmitter
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
  const uniqueSerials = [...new Set(serials.map((serial) => serial.trim()).filter(Boolean))]
  if (uniqueSerials.length === 0) return { ok: false, error: 'Select at least one device.' }

  const started: string[] = []
  for (const serial of uniqueSerials) {
    if (activeProcesses.has(serial)) {
      emitMessage(emit, serial, 'error', 'scrcpy is already running for this device.')
      continue
    }

    let args: string[]
    try {
      args = buildScrcpyArgs(launch, serial)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }

    const child = spawn(scrcpyPath, args, {
      windowsHide: true,
      env: { ...process.env, LANG: 'en_US.UTF-8' }
    })
    activeProcesses.set(serial, child)
    started.push(serial)
    emitMessage(emit, serial, 'starting', `${scrcpyPath} ${args.join(' ')}`)

    let recentError = ''
    child.stdout.on('data', (chunk: Buffer) => {
      const message = chunk.toString().trim()
      if (message) emitMessage(emit, serial, 'log', message)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString().trim()
      if (!message) return
      recentError = `${recentError}\n${message}`.trim().slice(-4000)
      emitMessage(emit, serial, 'log', message)
    })
    child.on('error', (error) => {
      activeProcesses.delete(serial)
      emitMessage(emit, serial, 'error', error.message)
    })
    child.on('close', (code, signal) => {
      activeProcesses.delete(serial)
      if (code === 0 || signal === 'SIGTERM') {
        emitMessage(emit, serial, 'stopped', 'scrcpy stopped.')
      } else {
        emitMessage(emit, serial, 'error', recentError || `scrcpy exited with code ${code ?? 'unknown'}.`)
      }
    })

    setTimeout(() => {
      if (activeProcesses.get(serial) === child && child.exitCode === null) {
        emitMessage(emit, serial, 'running', 'scrcpy is running.')
      }
    }, 1_200)
  }

  return started.length > 0
    ? { ok: true, data: started }
    : { ok: false, error: 'No new scrcpy process was started.' }
}

export function stopScrcpy(serial: string): OperationResult {
  const child = activeProcesses.get(serial)
  if (!child) return { ok: false, error: 'No running scrcpy process found for this device.' }
  child.kill()
  return { ok: true }
}

export function stopAllScrcpy(): void {
  for (const child of activeProcesses.values()) child.kill()
  activeProcesses.clear()
}

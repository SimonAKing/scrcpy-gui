import type { RuntimeConfig } from '../shared/types'
import { executeCommand, resolveBinary, type CommandOutput } from './runtime'

export interface AdbRunOptions {
  timeout?: number
  maxBuffer?: number
}

export interface AdbClient {
  run(runtime: RuntimeConfig, args: string[], options?: AdbRunOptions): Promise<CommandOutput>
  runForDevice(runtime: RuntimeConfig, serial: string, args: string[], options?: AdbRunOptions): Promise<CommandOutput>
}

// adb prints these lines only when the client it was invoked from had to spawn the
// server itself. The server then runs detached from our own adb binary, so it outlives
// the app and keeps the install directory locked on Windows until we stop it.
const DAEMON_START_PATTERN = /daemon not running|daemon started successfully/i

let serverStartedByApp = false

export function noteAdbOutput(output: string): void {
  if (DAEMON_START_PATTERN.test(output)) serverStartedByApp = true
}

export function adbServerStartedByApp(): boolean {
  return serverStartedByApp
}

export function forgetAdbServerOwnership(): void {
  serverStartedByApp = false
}

export class AdbService implements AdbClient {
  async run(runtime: RuntimeConfig, args: string[], options: AdbRunOptions = {}): Promise<CommandOutput> {
    const executable = await resolveBinary(runtime, 'adb')
    if (!executable) throw new Error('adb executable not found.')
    try {
      const result = await executeCommand(executable, args, options.timeout, options.maxBuffer)
      noteAdbOutput(`${result.stdout}\n${result.stderr}`)
      return result
    } catch (error) {
      noteAdbOutput(error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  runForDevice(runtime: RuntimeConfig, serial: string, args: string[], options?: AdbRunOptions): Promise<CommandOutput> {
    return this.run(runtime, ['-s', serial, ...args], options)
  }
}

export const adbService = new AdbService()

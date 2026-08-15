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

export class AdbService implements AdbClient {
  async run(runtime: RuntimeConfig, args: string[], options: AdbRunOptions = {}): Promise<CommandOutput> {
    const executable = await resolveBinary(runtime, 'adb')
    if (!executable) throw new Error('adb executable not found.')
    return executeCommand(executable, args, options.timeout, options.maxBuffer)
  }

  runForDevice(runtime: RuntimeConfig, serial: string, args: string[], options?: AdbRunOptions): Promise<CommandOutput> {
    return this.run(runtime, ['-s', serial, ...args], options)
  }
}

export const adbService = new AdbService()

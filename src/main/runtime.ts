import { execFile } from 'node:child_process'
import { constants as fsConstants, existsSync, statSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import type { RuntimeConfig } from '../shared/types'

export interface CommandOutput {
  stdout: string
  stderr: string
}

export class CommandExecutionError extends Error {
  constructor(message: string, readonly exitCode?: number) {
    super(message)
    this.name = 'CommandExecutionError'
  }
}

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
    if (stats.isDirectory()) candidates.push(join(configured, name))
    else if (binary === 'scrcpy') candidates.push(configured)
    else candidates.push(join(dirname(configured), name))
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
  for (const folder of pathFolders) candidates.push(join(folder, name))

  for (const candidate of [...new Set(candidates)]) {
    if (await canExecute(candidate)) return candidate
  }
  return ''
}

export function executeCommand(file: string, args: string[], timeout = 15_000, maxBuffer = 2 * 1024 * 1024): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout, windowsHide: true, maxBuffer, env: { ...process.env, LANG: 'en_US.UTF-8' } },
      (error, stdout, stderr) => {
        if (error) {
          const details = String(stderr || stdout || error.message).trim()
          reject(new CommandExecutionError(details, typeof error.code === 'number' ? error.code : undefined))
          return
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) })
      }
    )
  })
}

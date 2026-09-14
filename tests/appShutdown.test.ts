import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { adbServerStartedByApp, forgetAdbServerOwnership, noteAdbOutput } from '../src/main/adbService'

const main = readFileSync(resolve(process.cwd(), 'src/main/main.ts'), 'utf8')

describe('ADB server ownership', () => {
  beforeEach(() => {
    forgetAdbServerOwnership()
  })

  it('claims ownership only when adb reports that it had to start the server', () => {
    expect(adbServerStartedByApp()).toBe(false)
    noteAdbOutput('List of devices attached\nABC\tdevice\n')
    expect(adbServerStartedByApp()).toBe(false)
    noteAdbOutput('* daemon not running; starting now at tcp:5037\n')
    expect(adbServerStartedByApp()).toBe(true)
  })

  it('claims ownership from the confirmation line alone', () => {
    noteAdbOutput('* daemon started successfully\n')
    expect(adbServerStartedByApp()).toBe(true)
  })

  it('does not claim a server it only failed to reach', () => {
    noteAdbOutput('adb: error: failed to check server version: cannot connect to daemon\n')
    expect(adbServerStartedByApp()).toBe(false)
  })

  it('releases ownership once the server has been stopped', () => {
    noteAdbOutput('* daemon not running; starting now at tcp:5037\n')
    forgetAdbServerOwnership()
    expect(adbServerStartedByApp()).toBe(false)
  })
})

describe('quit sequence', () => {
  it('routes every quit through one guarded shutdown', () => {
    // The tray menu used to call app.quit() with its own bookkeeping, which let a second
    // click tear the app down while the ADB cleanup was still running.
    expect(main).toContain("{ label: 'Quit', click: () => app.quit() }")
    expect(main).toMatch(/app\.on\('before-quit', \(event\) => \{\s*(\/\/[^\n]*\n\s*)*if \(shutdownFinished\) return\s*\n\s*event\.preventDefault\(\)/)
    expect(main).toContain('void beginShutdown().then(() => {')
  })

  it('stops an ADB server this app started even when the user opted out', () => {
    expect(main).toContain('const shouldStopAdb = killAdbOnQuit || adbServerStartedByApp()')
  })

  it('bounds the shutdown so an unresponsive adb cannot block quitting', () => {
    expect(main).toContain('withShutdownTimeout(stopAdbServer(quitRuntime))')
    expect(main).toMatch(/const SHUTDOWN_TIMEOUT_MS = [\d_]+/)
  })

  it('starts the shutdown only once', () => {
    expect(main).toMatch(/function beginShutdown\(\): Promise<void> \{\s*if \(shutdownPromise\) return shutdownPromise/)
  })
})

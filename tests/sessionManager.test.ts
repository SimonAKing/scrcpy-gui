import { afterEach, describe, expect, it } from 'vitest'
import type { SceneKind, ScrcpySession, ScrcpySessionEvent, SessionState } from '../src/shared/types'
import { canTransitionSession, ScrcpySessionManager } from '../src/main/sessionManager'

const managers: ScrcpySessionManager[] = []

function manager(): ScrcpySessionManager {
  const instance = new ScrcpySessionManager({ startupWindowMs: 30, stopGraceMs: 100 })
  managers.push(instance)
  return instance
}

function launchFake(instance: ScrcpySessionManager, serial: string, source: string, scene: SceneKind = 'screen'): ScrcpySession {
  return instance.launch({
    executable: process.execPath,
    serial,
    scene,
    args: ['-e', source]
  })
}

async function waitForState(
  instance: ScrcpySessionManager,
  id: string,
  expected: SessionState,
  timeoutMs = 5_000
): Promise<ScrcpySession> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const session = instance.list().find((item) => item.id === id)
    if (session?.state === expected) return session
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const current = instance.list().find((item) => item.id === id)
  throw new Error(`Timed out waiting for ${expected}; current state is ${current?.state || 'missing'}.`)
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for condition.')
}

afterEach(async () => {
  for (const instance of managers.splice(0)) instance.stopAll('app-quit')
  await new Promise((resolve) => setTimeout(resolve, 150))
})

describe('session state transitions', () => {
  it('allows only declared lifecycle transitions', () => {
    expect(canTransitionSession('queued', 'preflighting')).toBe(true)
    expect(canTransitionSession('preflighting', 'launching')).toBe(true)
    expect(canTransitionSession('launching', 'running')).toBe(true)
    expect(canTransitionSession('running', 'stopping')).toBe(true)
    expect(canTransitionSession('stopping', 'stopped')).toBe(true)
    expect(canTransitionSession('stopped', 'running')).toBe(false)
    expect(canTransitionSession('failed', 'launching')).toBe(false)
  })
})

describe('ScrcpySessionManager integration', () => {
  it('does not report a spawned process as running until the startup window passes', async () => {
    const instance = manager()
    const events: SessionState[] = []
    const sessionEvents: ScrcpySessionEvent[] = []
    instance.subscribe((event) => {
      events.push(event.session.state)
      sessionEvents.push(event)
    })

    const launched = launchFake(instance, 'FAKE-001', 'process.stdout.write("fake output\\n"); setInterval(() => {}, 1000)')
    expect(launched.state).toBe('launching')
    expect(events).toEqual(['queued', 'preflighting', 'launching'])

    const running = await waitForState(instance, launched.id, 'running')
    expect(running.pid).toBeTypeOf('number')
    await waitFor(() => sessionEvents.some((event) => event.message === 'fake output'))
    expect(sessionEvents.find((event) => event.message === 'fake output')?.type).toBe('output')
    expect(instance.stop(launched.id)).toEqual({ ok: true })

    const stopped = await waitForState(instance, launched.id, 'stopped')
    expect(stopped.stopReason).toBe('user')
    expect(events).toContain('stopping')
    expect(events.at(-1)).toBe('stopped')
  })

  it('marks a process that exits during startup as failed with its stderr', async () => {
    const instance = new ScrcpySessionManager({ startupWindowMs: 1_000, stopGraceMs: 100 })
    managers.push(instance)
    const launched = launchFake(
      instance,
      'FAKE-002',
      'process.stderr.write("fake scrcpy startup failure\\n"); process.exit(9)'
    )

    const failed = await waitForState(instance, launched.id, 'failed')
    expect(failed.exitCode).toBe(9)
    expect(failed.stopReason).toBe('launch-error')
    expect(failed.error).toContain('fake scrcpy startup failure')
    expect(failed.startedAt).toBeUndefined()
  })

  it('records a normal process exit after running', async () => {
    const instance = manager()
    const launched = launchFake(instance, 'FAKE-003', 'setTimeout(() => process.exit(0), 150)')

    await waitForState(instance, launched.id, 'running')
    const stopped = await waitForState(instance, launched.id, 'stopped')
    expect(stopped.exitCode).toBe(0)
    expect(stopped.stopReason).toBe('process-exit')
    expect(stopped.startedAt).toBeTruthy()
    expect(stopped.endedAt).toBeTruthy()
  })

  it('fails and releases the conflict when scrcpy emits a startup fatal marker', async () => {
    const instance = new ScrcpySessionManager({ startupWindowMs: 1_000, stopGraceMs: 100 })
    managers.push(instance)
    const failedLaunch = launchFake(
      instance,
      'FAKE-FATAL',
      'process.stderr.write("ERROR: fake encoder unavailable\\n"); setInterval(() => {}, 1000)'
    )

    const failed = await waitForState(instance, failedLaunch.id, 'failed')
    expect(failed.error).toContain('fake encoder unavailable')

    const replacement = launchFake(instance, 'FAKE-FATAL', 'setInterval(() => {}, 1000)')
    expect(replacement.state).toBe('launching')
    expect(instance.stop(replacement.id)).toEqual({ ok: true })
    await waitForState(instance, replacement.id, 'stopped')
  })

  it('rejects a duplicate active screen session without disturbing the first process', async () => {
    const instance = manager()
    const first = launchFake(instance, 'FAKE-004', 'setInterval(() => {}, 1000)')
    const duplicate = launchFake(instance, 'FAKE-004', 'setInterval(() => {}, 1000)')

    expect(duplicate.state).toBe('failed')
    expect(duplicate.error).toContain('conflicts with screen')
    await waitForState(instance, first.id, 'running')
    expect(instance.stop(first.id)).toEqual({ ok: true })
    await waitForState(instance, first.id, 'stopped')
  })

  it('allows independent screen and camera sessions but applies the OTG conflict matrix', async () => {
    const instance = manager()
    const screen = launchFake(instance, 'FAKE-SCENES', 'setInterval(() => {}, 1000)')
    const camera = launchFake(instance, 'FAKE-SCENES', 'setInterval(() => {}, 1000)', 'camera')
    const otg = launchFake(instance, 'FAKE-SCENES', 'setInterval(() => {}, 1000)', 'otg')

    expect(screen.state).toBe('launching')
    expect(camera.state).toBe('launching')
    expect(otg.state).toBe('failed')
    expect(otg.error).toContain('conflicts')
    instance.stopAll()
    await waitForState(instance, screen.id, 'stopped')
    await waitForState(instance, camera.id, 'stopped')
  })

  it('captures spawn errors from a missing executable', async () => {
    const instance = manager()
    const launched = instance.launch({
      executable: `${process.execPath}.definitely-missing`,
      serial: 'FAKE-005',
      scene: 'screen',
      args: []
    })

    const failed = await waitForState(instance, launched.id, 'failed')
    expect(failed.stopReason).toBe('launch-error')
    expect(failed.error).toMatch(/ENOENT|not found/i)
  })
})

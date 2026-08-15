import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type {
  OperationResult,
  SceneKind,
  ScrcpySession,
  ScrcpySessionEvent,
  SessionState,
  SessionStopReason
} from '../shared/types'
import { operationFailure } from '../shared/errors'

export interface SessionLaunchRequest {
  executable: string
  serial: string
  scene: SceneKind
  args: string[]
}

interface SessionManagerOptions {
  startupWindowMs?: number
  stopGraceMs?: number
  now?: () => Date
  createId?: () => string
}

interface ActiveSession {
  child: ChildProcessWithoutNullStreams
  startupTimer?: NodeJS.Timeout
  forceStopTimer?: NodeJS.Timeout
  recentError: string
}

type SessionListener = (event: ScrcpySessionEvent) => void

const TERMINAL_STATES = new Set<SessionState>(['stopped', 'failed'])
const STARTUP_FATAL_PATTERN = /(?:^|\n)\s*(?:ERROR|FATAL):/i
const TRANSITIONS: Record<SessionState, ReadonlySet<SessionState>> = {
  queued: new Set(['preflighting', 'failed']),
  preflighting: new Set(['launching', 'failed']),
  launching: new Set(['running', 'stopping', 'failed']),
  running: new Set(['stopping', 'stopped', 'failed']),
  stopping: new Set(['stopped', 'failed']),
  stopped: new Set(),
  failed: new Set()
}

export function canTransitionSession(from: SessionState, to: SessionState): boolean {
  return TRANSITIONS[from].has(to)
}

function snapshot(session: ScrcpySession): ScrcpySession {
  return { ...session, args: [...session.args] }
}

function conflictKey(serial: string, scene: SceneKind): string {
  return `${serial}\0${scene}`
}

export class ScrcpySessionManager {
  private readonly sessions = new Map<string, ScrcpySession>()
  private readonly active = new Map<string, ActiveSession>()
  private readonly activeConflicts = new Map<string, string>()
  private readonly listeners = new Set<SessionListener>()
  private readonly startupWindowMs: number
  private readonly stopGraceMs: number
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(options: SessionManagerOptions = {}) {
    this.startupWindowMs = options.startupWindowMs ?? 8_000
    this.stopGraceMs = options.stopGraceMs ?? 2_000
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? randomUUID
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  list(): ScrcpySession[] {
    return [...this.sessions.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(snapshot)
  }

  launch(request: SessionLaunchRequest): ScrcpySession {
    const serial = request.serial.trim()
    const session: ScrcpySession = {
      id: this.createId(),
      serialAtLaunch: serial,
      scene: request.scene,
      state: 'queued',
      args: [...request.args],
      createdAt: this.timestamp()
    }
    this.sessions.set(session.id, session)
    this.emit(session, 'Session queued.')
    this.transition(session, 'preflighting', 'Checking session conflicts and launch inputs.')

    if (!serial || !request.executable.trim()) {
      return this.fail(session, 'A device serial and scrcpy executable are required.', 'launch-error')
    }

    const key = conflictKey(serial, request.scene)
    if (this.activeConflicts.has(key)) {
      return this.fail(session, 'An active screen session already exists for this device.', 'launch-error')
    }

    this.activeConflicts.set(key, session.id)
    this.transition(session, 'launching', 'Starting scrcpy.')

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(request.executable, request.args, {
        windowsHide: true,
        env: { ...process.env, LANG: 'en_US.UTF-8' }
      })
    } catch (error) {
      this.releaseConflict(session)
      return this.fail(session, error instanceof Error ? error.message : String(error), 'launch-error')
    }

    const active: ActiveSession = { child, recentError: '' }
    this.active.set(session.id, active)
    if (child.pid) session.pid = child.pid

    child.once('spawn', () => {
      if (child.pid) session.pid = child.pid
      this.emit(session, `scrcpy process spawned${child.pid ? ` with PID ${child.pid}` : ''}.`)
      active.startupTimer = setTimeout(() => {
        if (session.state === 'launching' && child.exitCode === null && child.signalCode === null) {
          session.startedAt = this.timestamp()
          this.transition(session, 'running', 'scrcpy passed the startup window and is running.')
        }
      }, this.startupWindowMs)
    })

    child.stdout.on('data', (chunk: Buffer) => this.emitOutput(session, String(chunk)))
    child.stderr.on('data', (chunk: Buffer) => {
      const message = String(chunk).trim()
      if (!message) return
      active.recentError = `${active.recentError}\n${message}`.trim().slice(-4_000)
      this.emitOutput(session, message)
      if (session.state === 'launching' && STARTUP_FATAL_PATTERN.test(message)) {
        this.cleanup(session)
        this.fail(session, active.recentError, 'launch-error')
        child.kill('SIGTERM')
      }
    })

    child.once('error', (error) => {
      if (TERMINAL_STATES.has(session.state)) return
      this.cleanup(session)
      this.fail(session, error.message, 'launch-error')
    })

    child.once('close', (code, signal) => {
      const previousState = session.state
      const requestedStop = session.stopReason && session.stopReason !== 'process-exit' && session.stopReason !== 'launch-error'
      this.cleanup(session)
      if (TERMINAL_STATES.has(session.state)) return
      session.exitCode = code ?? undefined
      session.endedAt = this.timestamp()

      if (previousState === 'stopping' || requestedStop) {
        this.transition(session, 'stopped', `scrcpy stopped${signal ? ` with ${signal}` : ''}.`)
        return
      }
      if (previousState === 'launching' || previousState === 'preflighting' || previousState === 'queued') {
        this.fail(session, active.recentError || `scrcpy exited before it became ready (code ${code ?? 'unknown'}).`, 'launch-error')
        return
      }
      if (code === 0) {
        session.stopReason = 'process-exit'
        this.transition(session, 'stopped', 'scrcpy exited normally.')
      } else {
        this.fail(session, active.recentError || `scrcpy exited with code ${code ?? 'unknown'}.`, 'process-exit')
      }
    })

    return snapshot(session)
  }

  stop(id: string, reason: SessionStopReason = 'user'): OperationResult {
    const session = this.sessions.get(id)
    const active = this.active.get(id)
    if (!session || !active || TERMINAL_STATES.has(session.state)) {
      return operationFailure('SESSION_NOT_ACTIVE', 'session-stop', 'No active scrcpy session found.')
    }
    if (session.state !== 'stopping') {
      session.stopReason = reason
      this.transition(session, 'stopping', 'Stopping scrcpy.')
    }
    active.child.kill('SIGTERM')
    active.forceStopTimer = setTimeout(() => {
      if (this.active.has(id)) active.child.kill('SIGKILL')
    }, this.stopGraceMs)
    return { ok: true }
  }

  stopBySerial(serial: string, reason: SessionStopReason = 'user'): OperationResult {
    const id = this.activeConflicts.get(conflictKey(serial.trim(), 'screen'))
    return id ? this.stop(id, reason) : operationFailure(
      'SESSION_NOT_ACTIVE',
      'session-stop',
      'No running scrcpy process found for this device.'
    )
  }

  stopAll(reason: SessionStopReason = 'app-quit'): void {
    for (const id of [...this.active.keys()]) this.stop(id, reason)
  }

  private transition(session: ScrcpySession, state: SessionState, message: string): void {
    if (!canTransitionSession(session.state, state)) {
      throw new Error(`Invalid session transition: ${session.state} -> ${state}.`)
    }
    session.state = state
    this.emit(session, message)
  }

  private fail(session: ScrcpySession, error: string, reason: SessionStopReason): ScrcpySession {
    if (!TERMINAL_STATES.has(session.state)) {
      session.error = error
      session.stopReason = reason
      session.endedAt = this.timestamp()
      this.transition(session, 'failed', error)
    }
    return snapshot(session)
  }

  private cleanup(session: ScrcpySession): void {
    const active = this.active.get(session.id)
    if (active?.startupTimer) clearTimeout(active.startupTimer)
    if (active?.forceStopTimer) clearTimeout(active.forceStopTimer)
    this.active.delete(session.id)
    this.releaseConflict(session)
  }

  private releaseConflict(session: ScrcpySession): void {
    const key = conflictKey(session.serialAtLaunch, session.scene)
    if (this.activeConflicts.get(key) === session.id) this.activeConflicts.delete(key)
  }

  private emitOutput(session: ScrcpySession, message: string): void {
    const trimmed = message.trim()
    if (trimmed) this.emit(session, trimmed, 'output')
  }

  private emit(session: ScrcpySession, message: string, type: ScrcpySessionEvent['type'] = 'state'): void {
    const event: ScrcpySessionEvent = { type, session: snapshot(session), message, timestamp: this.timestamp() }
    for (const listener of this.listeners) listener(event)
  }

  private timestamp(): string {
    return this.now().toISOString()
  }
}

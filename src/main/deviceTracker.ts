import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Device, DeviceTrackerEvent } from '../shared/types'
import { parseAdbDevices } from './scrcpy'

type TrackerListener = (event: DeviceTrackerEvent) => void
export type TrackerSpawnProcess = (
  file: string,
  args: string[],
  options: { windowsHide: boolean; env: NodeJS.ProcessEnv }
) => ChildProcessWithoutNullStreams
type PollDevices = () => Promise<Device[]>

interface DeviceTrackerOptions {
  spawnProcess?: TrackerSpawnProcess
  pollDevices?: PollDevices
  restartBaseMs?: number
  restartMaxMs?: number
  pollVisibleMs?: number
  pollHiddenMs?: number
  fallbackAfterFailures?: number
  now?: () => Date
}

const MAX_TRACK_FRAME_BYTES = 2 * 1024 * 1024

export class AdbTrackFrameDecoder {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer): string[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const frames: string[] = []
    while (this.buffer.length >= 4) {
      const prefix = this.buffer.subarray(0, 4).toString('ascii')
      if (!/^[0-9a-fA-F]{4}$/.test(prefix)) throw new Error(`Invalid adb track-devices frame prefix: ${JSON.stringify(prefix)}.`)
      const length = Number.parseInt(prefix, 16)
      if (length > MAX_TRACK_FRAME_BYTES) throw new Error('adb track-devices frame exceeded the 2 MB safety limit.')
      if (this.buffer.length < 4 + length) break
      frames.push(this.buffer.subarray(4, 4 + length).toString('utf8'))
      this.buffer = this.buffer.subarray(4 + length)
    }
    if (this.buffer.length > MAX_TRACK_FRAME_BYTES + 4) throw new Error('adb track-devices buffer exceeded the 2 MB safety limit.')
    return frames
  }
}

export function parseTrackDevicesSnapshot(payload: string): Device[] {
  return parseAdbDevices(`List of devices attached\n${payload}`)
}

function sameDevice(left: Device, right: Device): boolean {
  return left.state === right.state && left.model === right.model && left.product === right.product &&
    left.device === right.device && left.transportId === right.transportId && left.connection === right.connection
}

function normalizedDevices(devices: Device[]): Device[] {
  return [...new Map(devices.filter((device) => device.serial).map((device) => [device.serial, device])).values()]
}

export class DeviceTracker {
  private readonly listeners = new Set<TrackerListener>()
  private readonly spawnProcess: TrackerSpawnProcess
  private readonly pollDevices?: PollDevices
  private readonly restartBaseMs: number
  private readonly restartMaxMs: number
  private readonly pollVisibleMs: number
  private readonly pollHiddenMs: number
  private readonly fallbackAfterFailures: number
  private readonly now: () => Date
  private child?: ChildProcessWithoutNullStreams
  private restartTimer?: NodeJS.Timeout
  private pollTimer?: NodeJS.Timeout
  private executable = ''
  private stopped = true
  private visible = true
  private generation = 0
  private consecutiveFailures = 0
  private revision = 0
  private devices: Device[] = []
  private source: DeviceTrackerEvent['source'] = 'track'
  private hasSnapshot = false

  constructor(options: DeviceTrackerOptions = {}) {
    this.spawnProcess = options.spawnProcess ?? spawn
    this.pollDevices = options.pollDevices
    this.restartBaseMs = options.restartBaseMs ?? 250
    this.restartMaxMs = options.restartMaxMs ?? 10_000
    this.pollVisibleMs = options.pollVisibleMs ?? 2_000
    this.pollHiddenMs = options.pollHiddenMs ?? 10_000
    this.fallbackAfterFailures = options.fallbackAfterFailures ?? 3
    this.now = options.now ?? (() => new Date())
  }

  subscribe(listener: TrackerListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(executable: string): Device[] {
    const path = executable.trim()
    if (!path) throw new Error('adb executable not found.')
    if (!this.stopped && this.executable === path && (this.child || this.restartTimer || this.pollTimer)) return this.snapshot()
    this.stop(false)
    this.stopped = false
    this.executable = path
    this.consecutiveFailures = 0
    this.source = 'track'
    this.launchTrack()
    return this.snapshot()
  }

  stop(emit = true): void {
    this.stopped = true
    this.generation += 1
    if (this.restartTimer) clearTimeout(this.restartTimer)
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.restartTimer = undefined
    this.pollTimer = undefined
    const child = this.child
    this.child = undefined
    child?.kill('SIGTERM')
    if (emit) this.emit('stopped', 'Device tracking stopped.')
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    if (this.source === 'poll' && !this.stopped) this.schedulePoll(0)
  }

  snapshot(): Device[] {
    return this.devices.map((device) => ({ ...device }))
  }

  private launchTrack(): void {
    if (this.stopped) return
    const generation = ++this.generation
    const decoder = new AdbTrackFrameDecoder()
    let stderr = ''
    let settled = false
    this.source = 'track'
    this.emit('starting', 'Starting adb track-devices -l.')
    const child = this.spawnProcess(this.executable, ['track-devices', '-l'], {
      windowsHide: true,
      env: { ...process.env, LANG: 'en_US.UTF-8' }
    }) as ChildProcessWithoutNullStreams
    this.child = child

    child.once('spawn', () => {
      if (generation === this.generation && !this.stopped) this.emit('tracking', 'ADB tracker connected; waiting for device changes.')
    })

    child.stdout.on('data', (chunk: Buffer) => {
      if (generation !== this.generation || this.stopped) return
      try {
        for (const frame of decoder.push(chunk)) {
          this.consecutiveFailures = 0
          this.apply(parseTrackDevicesSnapshot(frame), 'track', 'ADB device snapshot updated.')
        }
      } catch (error) {
        stderr = error instanceof Error ? error.message : String(error)
        child.kill('SIGTERM')
      }
    })
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}\n${String(chunk)}`.trim().slice(-4_000) })
    const failed = (message: string): void => {
      if (settled || generation !== this.generation || this.stopped) return
      settled = true
      this.child = undefined
      this.consecutiveFailures += 1
      this.emit('error', message)
      if (this.pollDevices && this.consecutiveFailures >= this.fallbackAfterFailures) {
        this.source = 'poll'
        this.schedulePoll(0)
      } else {
        const delay = Math.min(this.restartBaseMs * (2 ** (this.consecutiveFailures - 1)), this.restartMaxMs)
        this.emit('restarting', `ADB tracker exited; retrying in ${delay} ms.`, delay)
        this.restartTimer = setTimeout(() => { this.restartTimer = undefined; this.launchTrack() }, delay)
      }
    }
    child.once('error', (error) => failed(error.message))
    child.once('close', (code, signal) => failed(stderr || `adb track-devices exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}.`))
  }

  private schedulePoll(delay = this.visible ? this.pollVisibleMs : this.pollHiddenMs): void {
    if (this.pollTimer) clearTimeout(this.pollTimer)
    if (this.stopped || !this.pollDevices) return
    this.pollTimer = setTimeout(async () => {
      this.pollTimer = undefined
      try {
        this.apply(await this.pollDevices!(), 'poll', 'ADB polling snapshot updated.')
      } catch (error) {
        this.emit('error', error instanceof Error ? error.message : String(error))
      }
      this.schedulePoll()
    }, delay)
  }

  private apply(nextValue: Device[], source: DeviceTrackerEvent['source'], message: string): void {
    const next = normalizedDevices(nextValue)
    const previousBySerial = new Map(this.devices.map((device) => [device.serial, device]))
    const nextBySerial = new Map(next.map((device) => [device.serial, device]))
    const added = next.filter((device) => !previousBySerial.has(device.serial))
    const changed = next.filter((device) => {
      const previous = previousBySerial.get(device.serial)
      return previous ? !sameDevice(previous, device) : false
    })
    const removed = this.devices.filter((device) => !nextBySerial.has(device.serial))
    const changedSnapshot = added.length > 0 || changed.length > 0 || removed.length > 0 || !this.hasSnapshot
    this.devices = next
    this.source = source
    this.hasSnapshot = true
    if (!changedSnapshot) return
    this.revision += 1
    this.emit('tracking', message, undefined, { added, changed, removed })
  }

  private emit(
    status: DeviceTrackerEvent['status'],
    message: string,
    retryInMs?: number,
    delta: Pick<DeviceTrackerEvent, 'added' | 'changed' | 'removed'> = { added: [], changed: [], removed: [] }
  ): void {
    const event: DeviceTrackerEvent = {
      status, source: this.source, devices: this.snapshot(),
      added: delta.added.map((device) => ({ ...device })), changed: delta.changed.map((device) => ({ ...device })),
      removed: delta.removed.map((device) => ({ ...device })), revision: this.revision,
      timestamp: this.now().toISOString(), message, retryInMs
    }
    for (const listener of this.listeners) listener(event)
  }
}

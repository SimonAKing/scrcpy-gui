import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { DeviceTrackerEvent } from '../src/shared/types'
import { AdbTrackFrameDecoder, DeviceTracker, parseTrackDevicesSnapshot, type TrackerSpawnProcess } from '../src/main/deviceTracker'

function frame(payload: string): Buffer {
  const data = Buffer.from(payload)
  return Buffer.concat([Buffer.from(data.length.toString(16).padStart(4, '0')), data])
}

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false
  kill(): boolean {
    this.killed = true
    return true
  }
}

const trackers: DeviceTracker[] = []

afterEach(() => {
  for (const tracker of trackers.splice(0)) tracker.stop(false)
  vi.useRealTimers()
})

describe('AdbTrackFrameDecoder', () => {
  it('decodes empty, split and coalesced ADB length-prefixed snapshots', () => {
    const decoder = new AdbTrackFrameDecoder()
    expect(decoder.push(Buffer.from('00'))).toEqual([])
    expect(decoder.push(Buffer.from('00'))).toEqual([''])
    const snapshots = Buffer.concat([frame('ABC\tdevice model:Pixel_8\n'), frame('')])
    expect(decoder.push(snapshots.subarray(0, 9))).toEqual([])
    expect(decoder.push(snapshots.subarray(9))).toEqual(['ABC\tdevice model:Pixel_8\n', ''])
  })

  it('rejects malformed prefixes before buffering untrusted output', () => {
    expect(() => new AdbTrackFrameDecoder().push(Buffer.from('oops'))).toThrow('Invalid adb track-devices frame prefix')
  })
})

describe('parseTrackDevicesSnapshot', () => {
  it('parses detailed USB, wireless and authorization states', () => {
    expect(parseTrackDevicesSnapshot(
      'ABC\tunauthorized usb:1-2 transport_id:1\n192.168.1.8:5555\tdevice product:panther model:Pixel_7 device:panther transport_id:2\n'
    )).toMatchObject([
      { serial: 'ABC', state: 'unauthorized', connection: 'usb' },
      { serial: '192.168.1.8:5555', state: 'device', model: 'Pixel 7', connection: 'wireless' }
    ])
  })
})

describe('DeviceTracker', () => {
  it('synchronizes a polled snapshot before the streaming tracker starts', () => {
    const child = new FakeChild()
    const tracker = new DeviceTracker({ spawnProcess: (() => child as unknown as ChildProcessWithoutNullStreams) })
    trackers.push(tracker)
    const events: DeviceTrackerEvent[] = []
    tracker.subscribe((event) => events.push(event))

    const devices = parseTrackDevicesSnapshot('WIFI:5555\tdevice model:Wireless_Phone transport_id:3\n')
    expect(tracker.synchronize(devices)).toMatchObject([
      { serial: 'WIFI:5555', state: 'device', connection: 'wireless' }
    ])
    expect(tracker.start('/fake/adb')).toMatchObject([{ serial: 'WIFI:5555' }])
    expect(events[0]).toMatchObject({ status: 'tracking', source: 'track', revision: 1 })
  })

  it('emits added, changed and removed deltas without duplicate serials', () => {
    const child = new FakeChild()
    const tracker = new DeviceTracker({ spawnProcess: (() => child as unknown as ChildProcessWithoutNullStreams) })
    trackers.push(tracker)
    const events: DeviceTrackerEvent[] = []
    tracker.subscribe((event) => events.push(event))
    tracker.start('/fake/adb')

    child.stdout.write(frame('ABC\tdevice model:Pixel_8 transport_id:1\nABC\tdevice model:Duplicate transport_id:2\n'))
    child.stdout.write(frame('ABC\tunauthorized transport_id:1\nWIFI:5555\tdevice model:Tablet transport_id:3\n'))
    child.stdout.write(frame('WIFI:5555\tdevice model:Tablet transport_id:3\n'))

    const snapshots = events.filter((event) => event.status === 'tracking')
    expect(snapshots).toHaveLength(3)
    expect(snapshots[0].devices).toHaveLength(1)
    expect(snapshots[0].added.map((device) => device.serial)).toEqual(['ABC'])
    expect(snapshots[1].changed.map((device) => device.serial)).toEqual(['ABC'])
    expect(snapshots[1].added.map((device) => device.serial)).toEqual(['WIFI:5555'])
    expect(snapshots[2].removed.map((device) => device.serial)).toEqual(['ABC'])
    expect(snapshots.map((event) => event.revision)).toEqual([1, 2, 3])
  })

  it('backs off exponentially and resets the delay after a valid snapshot', async () => {
    vi.useFakeTimers()
    const children = [new FakeChild(), new FakeChild(), new FakeChild()]
    const spawnProcess = vi.fn(() => children.shift() as unknown as ChildProcessWithoutNullStreams)
    const tracker = new DeviceTracker({ spawnProcess: spawnProcess as TrackerSpawnProcess, restartBaseMs: 100, restartMaxMs: 1_000 })
    trackers.push(tracker)
    const events: DeviceTrackerEvent[] = []
    tracker.subscribe((event) => events.push(event))
    tracker.start('/fake/adb')

    ;(spawnProcess.mock.results[0].value as FakeChild).emit('close', 1, null)
    expect(events.at(-1)).toMatchObject({ status: 'restarting', retryInMs: 100 })
    await vi.advanceTimersByTimeAsync(100)
    ;(spawnProcess.mock.results[1].value as FakeChild).emit('close', 1, null)
    expect(events.at(-1)).toMatchObject({ status: 'restarting', retryInMs: 200 })
    await vi.advanceTimersByTimeAsync(200)
    const third = spawnProcess.mock.results[2].value as FakeChild
    third.stdout.write(frame(''))
    third.emit('close', 1, null)
    expect(events.at(-1)).toMatchObject({ status: 'restarting', retryInMs: 100 })
  })

  it('falls back to visibility-aware polling after repeated early failures', async () => {
    vi.useFakeTimers()
    const first = new FakeChild()
    const second = new FakeChild()
    const children = [first, second]
    const pollDevices = vi.fn(async () => parseTrackDevicesSnapshot('POLL\tdevice model:Fallback\n'))
    const spawnProcess = vi.fn(() => children.shift() as unknown as ChildProcessWithoutNullStreams)
    const tracker = new DeviceTracker({ spawnProcess: spawnProcess as TrackerSpawnProcess, pollDevices, fallbackAfterFailures: 2, restartBaseMs: 10 })
    trackers.push(tracker)
    const events: DeviceTrackerEvent[] = []
    tracker.subscribe((event) => events.push(event))
    tracker.start('/fake/adb')

    first.emit('close', 1, null)
    await vi.advanceTimersByTimeAsync(10)
    second.emit('close', 1, null)
    await vi.advanceTimersByTimeAsync(0)

    expect(pollDevices).toHaveBeenCalledOnce()
    expect(events.findLast((event) => event.status === 'tracking')).toMatchObject({ source: 'poll', added: [{ serial: 'POLL' }] })
  })

  it('tracks a controlled fake ADB child process through the real stream boundary', async () => {
    const source = `
      const payload = Buffer.from('REAL\\tdevice model:Fake_Phone transport_id:7\\n');
      process.stdout.write(payload.length.toString(16).padStart(4, '0'));
      process.stdout.write(payload);
      setInterval(() => {}, 1000);
    `
    const tracker = new DeviceTracker({
      spawnProcess: (() => spawn(process.execPath, ['-e', source])) as TrackerSpawnProcess,
      restartBaseMs: 10_000
    })
    trackers.push(tracker)

    const snapshot = await new Promise<DeviceTrackerEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for fake ADB snapshot.')), 5_000)
      tracker.subscribe((event) => {
        if (event.status === 'tracking' && event.revision > 0) { clearTimeout(timer); resolve(event) }
      })
      tracker.start('/fake/adb')
    })
    expect(snapshot.devices).toMatchObject([{ serial: 'REAL', model: 'Fake Phone', transportId: '7' }])
  })
})

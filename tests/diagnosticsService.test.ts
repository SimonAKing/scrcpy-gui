import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AppEvent, EnvironmentStatus } from '../src/shared/types'
import { defaultPersistedConfig } from '../src/shared/config'
import { crc32, createZip } from '../src/main/zip'
import { DiagnosticsService, MAX_DIAGNOSTIC_BYTES, type DiagnosticContext } from '../src/main/diagnosticsService'

const directories: string[] = []

function zipEntries(archive: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>()
  let offset = 0
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = archive.readUInt32LE(offset + 18)
    const nameLength = archive.readUInt16LE(offset + 26)
    const extraLength = archive.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = archive.subarray(nameStart, nameStart + nameLength).toString('utf8')
    entries.set(name, archive.subarray(dataStart, dataStart + compressedSize))
    offset = dataStart + compressedSize
  }
  return entries
}

function environment(): EnvironmentStatus {
  return {
    scrcpy: { ok: true, path: '/Users/alice/Tools/scrcpy', version: 'scrcpy 4.1', error: '' },
    adb: { ok: true, path: '/Users/alice/Android/adb', version: 'Android Debug Bridge version 1.0.41', error: '' }
  }
}

function context(events: AppEvent[] = []): DiagnosticContext {
  const config = defaultPersistedConfig('en')
  config.runtime.scrcpyPath = '/Users/alice/Tools/scrcpy'
  config.wirelessTargets.push({ id: 'target-1', name: 'Phone', address: 'phone.local:37099', autoConnect: false })
  config.automations.push({ id: 'macro-1', name: 'Sensitive macro', steps: [{ action: 'home', delayMs: 0 }] })
  return {
    generatedAt: '2026-08-15T12:00:00.000Z', appVersion: '2.0.0-beta.5', electronVersion: '43.4.0', nodeVersion: '24.0.0',
    platform: 'darwin', release: '25.0.0', arch: 'arm64', homePath: '/Users/alice',
    userDataPath: '/Users/alice/Library/Application Support/scrcpy-gui', environment: environment(),
    devices: [{ serial: '192.168.1.5:5555', state: 'device', model: 'Pixel', product: 'pixel', device: 'pixel', connection: 'wireless' }],
    sessions: [{
      id: 'session-1', serialAtLaunch: '192.168.1.5:5555', scene: 'screen', state: 'failed', createdAt: '2026-08-15T11:00:00.000Z',
      args: ['--serial=192.168.1.5:5555', '--record=/Users/alice/Videos/private.mp4'], error: 'device 192.168.1.5:5555 failed'
    }],
    events,
    config
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('ZIP writer', () => {
  it('writes valid stored entries with CRC32 and UTF-8 names', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    const archive = createZip([
      { name: 'one.txt', data: 'one' },
      { name: '目录/two.txt', data: Buffer.from('two') }
    ], new Date('2026-08-15T12:00:00.000Z'))
    expect(archive.readUInt32LE(0)).toBe(0x04034b50)
    expect(archive.readUInt32LE(archive.length - 22)).toBe(0x06054b50)
    expect(zipEntries(archive)).toEqual(new Map([
      ['one.txt', Buffer.from('one')],
      ['目录/two.txt', Buffer.from('two')]
    ]))
  })

  it('rejects traversal and absolute entry names', () => {
    expect(() => createZip([{ name: '../secret.txt', data: 'x' }])).toThrow('Unsafe ZIP entry')
    expect(() => createZip([{ name: '/secret.txt', data: 'x' }])).toThrow('Unsafe ZIP entry')
  })
})

describe('DiagnosticsService', () => {
  it('builds a complete default-redacted bundle without automation bodies or raw identifiers', () => {
    const events: AppEvent[] = [{
      id: 'event-1', timestamp: '2026-08-15T11:30:00.000Z', level: 'error', domain: 'device', action: 'pair',
      deviceId: '192.168.1.5:5555', message: 'Pair 192.168.1.5:5555 with 123456 via phone.local:37099',
      data: { detail: '/Users/alice/Library/Application Support/scrcpy-gui/log.txt' }
    }]
    const prepared = new DiagnosticsService().prepare(context(events))
    const entries = zipEntries(prepared.archive)
    const combined = [...entries.values()].map((value) => value.toString('utf8')).join('\n')

    expect([...entries.keys()]).toEqual([
      'diagnostic-manifest.json', 'environment.json', 'devices.json', 'sessions.json', 'events.json', 'config-summary.json', 'README.txt'
    ])
    expect(combined).not.toContain('192.168.1.5:5555')
    expect(combined).not.toContain('phone.local:37099')
    expect(combined).not.toContain('/Users/alice')
    expect(combined).not.toContain('123456')
    expect(combined).not.toContain('Sensitive macro')
    expect(combined).toContain('device-')
    expect(combined).toContain('$APP_DATA')
    expect(combined).toContain('<redacted-code>')
    expect(prepared.preview.redactions.some((item) => item.kind === 'device-serial' && item.count > 0)).toBe(true)
    expect(prepared.preview.eventCount).toBe(1)
    expect(prepared.archive.length).toBeLessThanOrEqual(MAX_DIAGNOSTIC_BYTES)
  })

  it('reduces the event window to stay below the hard 20 MiB bundle cap', () => {
    const events = Array.from({ length: 1_000 }, (_, index): AppEvent => ({
      id: `event-${index}`, timestamp: '2026-08-15T11:30:00.000Z', level: 'debug', domain: 'runtime', action: 'large',
      message: `${index}-${'x'.repeat(25_000)}`
    }))
    const prepared = new DiagnosticsService().prepare(context(events))
    expect(prepared.preview.eventCount).toBeLessThan(1_000)
    expect(prepared.archive.length).toBeLessThanOrEqual(MAX_DIAGNOSTIC_BYTES)
  })

  it('atomically writes a locally reviewable ZIP', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'scrcpy-gui-diagnostics-'))
    directories.push(directory)
    const path = join(directory, 'bundle.zip')
    const service = new DiagnosticsService()
    const prepared = service.prepare(context())
    await service.write(path, prepared)
    expect(await readFile(path)).toEqual(prepared.archive)
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
  })
})

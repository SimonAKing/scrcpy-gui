import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
// @ts-expect-error The executable .mjs intentionally has no application runtime dependency.
import { collectHardwarePreflight, parseAdbDevices, redactHardwareOutput } from '../scripts/hardware-smoke.mjs'

type Result = { code: number; stdout: string; stderr: string; timedOut?: boolean }
type Runner = (file: string, args: string[]) => Result

const ok = (stdout = ''): Result => ({ code: 0, stdout, stderr: '' })

describe('hardware smoke evidence tool', () => {
  it('parses authorized, unauthorized, offline and permission-denied devices', () => {
    expect(parseAdbDevices(`List of devices attached
USB-1 device product:pixel transport_id:1
10.0.0.2:5555 unauthorized transport_id:2
USB-3 offline
USB-4 no permissions (user missing udev rules)
`)).toEqual([
      { serial: 'USB-1', state: 'device' },
      { serial: '10.0.0.2:5555', state: 'unauthorized' },
      { serial: 'USB-3', state: 'offline' },
      { serial: 'USB-4', state: 'no permissions' }
    ])
  })

  it('writes a structured blocked result when no authorized device exists', () => {
    const run: Runner = (_file, args) => args[0] === 'devices'
      ? ok('List of devices attached\nUSB-1 unauthorized\n')
      : ok(args[0] === '--version' ? 'scrcpy 4.1' : 'Android Debug Bridge version 1.0.41')
    const result = collectHardwarePreflight({
      adb: '/adb', scrcpy: '/scrcpy', run, platform: 'linux', arch: 'x64',
      now: () => new Date('2026-08-15T12:00:00.000Z')
    })
    expect(result.exitCode).toBe(2)
    expect(result.report).toMatchObject({
      status: 'blocked', reason: 'no-authorized-device',
      discovery: { total: 1, authorized: 0, unauthorized: 1 }
    })
  })

  it('collects bounded probes without retaining serials, addresses or home paths', () => {
    const serial = '10.0.0.2:5555'
    const testHome = homedir()
    const run: Runner = (file, args) => {
      if (file === '/adb' && args[0] === 'devices') return ok(`List of devices attached\n${serial} device product:pixel\n`)
      if (args[0] === 'version') return ok('Android Debug Bridge version 1.0.41')
      if (args[0] === '--version') return ok('scrcpy 4.1 <https://github.com/Genymobile/scrcpy>')
      if (args.includes('ro.kernel.qemu')) return ok('')
      if (args.includes('ro.build.version.release')) return ok('16')
      if (args.includes('ro.build.version.sdk')) return ok('36')
      if (args.includes('ro.product.manufacturer')) return ok('Acme')
      if (args.includes('ro.product.model')) return ok('Phone')
      return ok(`probe for ${serial} at ${testHome}/private and 192.168.1.8:5555`)
    }
    const result = collectHardwarePreflight({
      adb: '/adb', scrcpy: '/scrcpy', serial, run, platform: 'darwin', arch: 'arm64',
      now: () => new Date('2026-08-15T12:00:00.000Z')
    })
    const json = JSON.stringify(result.report)
    expect(result.exitCode).toBe(0)
    expect(result.report).toMatchObject({
      status: 'ready-for-manual-scenes', target: { connection: 'tcpip', physical: true, androidRelease: '16', sdk: '36' }
    })
    expect(result.report.target.id).toMatch(/^device-[a-f0-9]{16}$/)
    expect(result.report.checklist).toHaveLength(10)
    expect(json).not.toContain(serial)
    expect(json).not.toContain('192.168.1.8')
    expect(json).not.toContain(testHome)
  })

  it('does not accept an emulator as physical-device evidence', () => {
    const run: Runner = (_file, args) => {
      if (args[0] === 'devices') return ok('List of devices attached\nemulator-5554 device\n')
      if (args.includes('ro.kernel.qemu')) return ok('1')
      return ok(args[0] === '--version' ? 'scrcpy 4.1' : 'Android Debug Bridge version 1.0.41')
    }
    const result = collectHardwarePreflight({ adb: '/adb', scrcpy: '/scrcpy', run })
    expect(result).toMatchObject({ exitCode: 2, report: { status: 'blocked', reason: 'emulator-not-physical' } })
  })

  it('redacts a selected serial, IP address and home directory', () => {
    expect(redactHardwareOutput('SERIAL at 10.1.2.3:5555 in /home/user/file', 'SERIAL', '/home/user'))
      .toBe('[device] at [address] in [home]/file')
  })
})

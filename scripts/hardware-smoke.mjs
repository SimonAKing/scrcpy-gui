import { createHash } from 'node:crypto'
import { access, mkdir, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const MAX_OUTPUT = 12_000
const TIMEOUT_MS = 20_000

function bounded(value) {
  const text = String(value || '').trim()
  return text.length <= MAX_OUTPUT ? text : `${text.slice(0, MAX_OUTPUT)}\n[truncated]`
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function redactHardwareOutput(value, serial = '', home = homedir()) {
  let result = bounded(value)
  if (serial) result = result.replace(new RegExp(escapeRegex(serial), 'g'), '[device]')
  if (home) result = result.replace(new RegExp(escapeRegex(home), 'g'), '[home]')
  return result
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '[address]')
    .replace(/\b[0-9a-f]{0,4}:[0-9a-f:]{2,}(?:%[\w.-]+)?(?:\]:\d+)?\b/gi, '[address]')
}

export function parseAdbDevices(output) {
  const devices = []
  for (const line of String(output || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('List of devices') || trimmed.startsWith('* daemon')) continue
    const match = trimmed.match(/^(\S+)\s+(device|unauthorized|offline|no permissions)(?:\s+.*)?$/)
    if (match) devices.push({ serial: match[1], state: match[2] })
  }
  return devices
}

function firstLine(value) {
  return bounded(value).split(/\r?\n/).find((line) => line.trim())?.trim() || ''
}

function deviceId(serial) {
  return `device-${createHash('sha256').update(serial).digest('hex').slice(0, 16)}`
}

function connectionKind(serial) {
  if (serial.startsWith('emulator-')) return 'emulator'
  return serial.includes(':') ? 'tcpip' : 'usb'
}

function defaultRun(file, args, timeout = TIMEOUT_MS) {
  const child = spawnSync(file, args, {
    encoding: 'utf8', timeout, maxBuffer: 1024 * 1024, windowsHide: true
  })
  return {
    code: child.status ?? 1,
    stdout: child.stdout || '',
    stderr: `${child.stderr || ''}${child.error ? `\n${child.error.message}` : ''}`,
    timedOut: child.error?.code === 'ETIMEDOUT'
  }
}

function commandRecord(result, serial) {
  return {
    ok: result.code === 0 && !result.timedOut,
    exitCode: result.code,
    timedOut: Boolean(result.timedOut),
    output: redactHardwareOutput(`${result.stdout || ''}\n${result.stderr || ''}`, serial)
  }
}

function blockedReport(base, reason, discovery, target) {
  return {
    ...base, status: 'blocked', reason, discovery,
    ...(target ? { target } : {}), probes: {}, checklist: []
  }
}

export function collectHardwarePreflight({
  adb, scrcpy, serial: requestedSerial = '', run = defaultRun,
  now = () => new Date(), platform = process.platform, arch = process.arch
}) {
  const adbVersionResult = run(adb, ['version'], 5_000)
  const scrcpyVersionResult = run(scrcpy, ['--version'], 5_000)
  const base = {
    schemaVersion: 1,
    createdAt: now().toISOString(),
    host: { platform, arch },
    runtime: {
      adb: redactHardwareOutput(firstLine(adbVersionResult.stdout || adbVersionResult.stderr)),
      scrcpy: redactHardwareOutput(firstLine(scrcpyVersionResult.stdout || scrcpyVersionResult.stderr))
    }
  }
  if (adbVersionResult.code !== 0 || scrcpyVersionResult.code !== 0 || adbVersionResult.timedOut || scrcpyVersionResult.timedOut) {
    return {
      report: blockedReport(base, 'runtime-version-failed', {
        total: 0, authorized: 0, unauthorized: 0, offline: 0,
        adb: commandRecord(adbVersionResult, ''), scrcpy: commandRecord(scrcpyVersionResult, '')
      }),
      exitCode: 2
    }
  }
  const discoveryResult = run(adb, ['devices', '-l'], 5_000)
  if (discoveryResult.code !== 0 || discoveryResult.timedOut) {
    return {
      report: blockedReport(base, 'adb-discovery-failed', {
        total: 0, authorized: 0, unauthorized: 0, offline: 0,
        error: commandRecord(discoveryResult, '')
      }),
      exitCode: 2
    }
  }

  const devices = parseAdbDevices(discoveryResult.stdout)
  const authorized = devices.filter((device) => device.state === 'device')
  const discovery = {
    total: devices.length,
    authorized: authorized.length,
    unauthorized: devices.filter((device) => device.state === 'unauthorized').length,
    offline: devices.filter((device) => device.state === 'offline').length,
    noPermissions: devices.filter((device) => device.state === 'no permissions').length
  }
  let selected
  if (requestedSerial) selected = devices.find((device) => device.serial === requestedSerial)
  else if (authorized.length === 1) selected = authorized[0]

  if (!selected) {
    const reason = requestedSerial
      ? 'selected-device-not-found'
      : authorized.length > 1 ? 'multiple-authorized-devices' : 'no-authorized-device'
    return { report: blockedReport(base, reason, discovery), exitCode: 2 }
  }
  const target = { id: deviceId(selected.serial), connection: connectionKind(selected.serial) }
  if (selected.state !== 'device') {
    return { report: blockedReport(base, `device-${selected.state.replace(/\s+/g, '-')}`, discovery, target), exitCode: 2 }
  }

  const propertyKeys = {
    androidRelease: 'ro.build.version.release', sdk: 'ro.build.version.sdk', manufacturer: 'ro.product.manufacturer',
    model: 'ro.product.model', emulator: 'ro.kernel.qemu'
  }
  const properties = {}
  const propertyErrors = {}
  for (const [name, key] of Object.entries(propertyKeys)) {
    const result = run(adb, ['-s', selected.serial, 'shell', 'getprop', key], 5_000)
    if (result.code === 0 && !result.timedOut) properties[name] = redactHardwareOutput(result.stdout, selected.serial)
    else propertyErrors[name] = commandRecord(result, selected.serial)
  }
  Object.assign(target, {
    physical: properties.emulator !== '1' && target.connection !== 'emulator',
    androidRelease: properties.androidRelease || 'unknown', sdk: properties.sdk || 'unknown',
    manufacturer: properties.manufacturer || 'unknown', model: properties.model || 'unknown'
  })
  if (propertyErrors.emulator) {
    return {
      report: { ...blockedReport(base, 'physical-status-unverified', discovery, target), propertyErrors },
      exitCode: 2
    }
  }
  if (!target.physical) {
    return {
      report: { ...blockedReport(base, 'emulator-not-physical', discovery, target), propertyErrors },
      exitCode: 2
    }
  }

  const probes = {}
  for (const [name, file, args] of [
    ['state', adb, ['-s', selected.serial, 'get-state']],
    ['displaySize', adb, ['-s', selected.serial, 'shell', 'wm', 'size']],
    ['encoders', scrcpy, [`--serial=${selected.serial}`, '--list-encoders']],
    ['displays', scrcpy, [`--serial=${selected.serial}`, '--list-displays']],
    ['cameras', scrcpy, [`--serial=${selected.serial}`, '--list-cameras']],
    ['cameraSizes', scrcpy, [`--serial=${selected.serial}`, '--list-camera-sizes']]
  ]) probes[name] = commandRecord(run(file, args), selected.serial)

  const checklist = [
    ['screen', 'Mirror the physical display and verify input control.'],
    ['audio', 'Verify forwarded device audio on a supported Android version.'],
    ['record', 'Create a recording, stop it, and replay the indexed artifact.'],
    ['camera', 'Run a supported camera source and record the selected camera/size result.'],
    ['virtual-display', 'Create a virtual display, launch an app, and verify teardown behavior.'],
    ['control-only', 'Verify keyboard/mouse control with video and audio disabled.'],
    ['otg', 'Verify no-ADB OTG control with USB debugging not used.'],
    ['v4l2', 'On Linux with v4l2loopback, verify frames reach the selected sink.'],
    ['pairing-mdns', 'Pair/connect through Android 11+ wireless debugging and rediscover the device.'],
    ['multi-device', 'Launch two physical devices and verify independent per-device results.']
  ].map(([id, instruction]) => ({
    id,
    status: id === 'v4l2' && platform !== 'linux' ? 'not-applicable-host' : 'pending-manual-hardware-run',
    instruction
  }))

  return {
    report: { ...base, status: 'ready-for-manual-scenes', discovery, target, propertyErrors, probes, checklist },
    exitCode: 0
  }
}

function parseArgs(argv) {
  const options = { serial: '', output: '' }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--serial' || arg === '--output') {
      const value = argv[++index]
      if (!value || value.includes('\0')) throw new Error(`${arg} requires a value.`)
      options[arg.slice(2)] = value
    } else if (arg === '--help') options.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

async function resolveBinaries(projectRoot) {
  const executable = process.platform === 'win32' ? '.exe' : ''
  const bundle = join(projectRoot, 'vendor', `scrcpy-${process.arch}`)
  const adb = process.env.SCRCPY_GUI_ADB || join(bundle, `adb${executable}`)
  const scrcpy = process.env.SCRCPY_GUI_SCRCPY || join(bundle, `scrcpy${executable}`)
  await Promise.all([access(adb), access(scrcpy)]).catch(() => {
    throw new Error('Bundled adb/scrcpy are unavailable. Run npm run prepare:scrcpy first or set SCRCPY_GUI_ADB and SCRCPY_GUI_SCRCPY.')
  })
  return { adb, scrcpy }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write('Usage: npm run smoke:hardware -- [--serial SERIAL] [--output REPORT.json]\n')
    return
  }
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const binaries = await resolveBinaries(projectRoot)
  const { report, exitCode } = collectHardwarePreflight({ ...binaries, serial: options.serial })
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  if (options.output) {
    const output = resolve(options.output)
    if (basename(output).toLowerCase().endsWith('.json') === false) throw new Error('--output must end with .json.')
    await mkdir(dirname(output), { recursive: true })
    const handle = await open(output, 'wx', 0o600)
    try { await handle.writeFile(serialized, 'utf8') } finally { await handle.close() }
    process.stderr.write(`Hardware preflight ${report.status}; wrote ${output}.\n`)
  } else process.stdout.write(serialized)
  process.exitCode = exitCode
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

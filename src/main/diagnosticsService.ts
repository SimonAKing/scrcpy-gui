import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  AppEvent,
  Device,
  DiagnosticPreview,
  EnvironmentStatus,
  PersistedConfig,
  ScrcpySession
} from '../shared/types'
import { createZip, type ZipEntry } from './zip'

export const MAX_DIAGNOSTIC_BYTES = 20 * 1024 * 1024

export interface DiagnosticContext {
  generatedAt: string
  appVersion: string
  electronVersion: string
  nodeVersion: string
  platform: string
  release: string
  arch: string
  homePath: string
  userDataPath: string
  environment: EnvironmentStatus
  devices: Device[]
  sessions: ScrcpySession[]
  events: AppEvent[]
  config?: PersistedConfig
}

export interface PreparedDiagnostics {
  preview: DiagnosticPreview
  archive: Buffer
}

interface RedactionSummary {
  counts: Map<string, number>
  replacements: Array<{ source: string; target: string; kind: string }>
  addressTokens: Map<string, string>
}

function stableDeviceId(serial: string): string {
  return `device-${createHash('sha256').update(serial).digest('hex').slice(0, 10)}`
}

function replaceLiteral(value: string, source: string, target: string): { value: string; count: number } {
  if (!source || !value.includes(source)) return { value, count: 0 }
  const pieces = value.split(source)
  return { value: pieces.join(target), count: pieces.length - 1 }
}

function addCount(summary: RedactionSummary, kind: string, count: number): void {
  if (count > 0) summary.counts.set(kind, (summary.counts.get(kind) || 0) + count)
}

function redactText(input: string, summary: RedactionSummary): string {
  let value = input
  for (const replacement of summary.replacements) {
    const result = replaceLiteral(value, replacement.source, replacement.target)
    value = result.value
    addCount(summary, replacement.kind, result.count)
  }
  value = value.replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, (address) => {
    let token = summary.addressTokens.get(address)
    if (!token) {
      token = `<device-address-${summary.addressTokens.size + 1}>`
      summary.addressTokens.set(address, token)
    }
    addCount(summary, 'device-address', 1)
    return token
  })
  value = value.replace(/\b\d{6}\b/g, () => {
    addCount(summary, 'pairing-code', 1)
    return '<redacted-code>'
  })
  value = value.replace(/(--record=)([^\s"']+)/g, (_match, prefix: string) => {
    addCount(summary, 'local-path', 1)
    return `${prefix}<local-path>`
  })
  return value
}

function redactValue(value: unknown, summary: RedactionSummary): unknown {
  if (typeof value === 'string') return redactText(value, summary)
  if (Array.isArray(value)) return value.map((item) => redactValue(item, summary))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactValue(item, summary)]))
  }
  return value
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function configSummary(config: PersistedConfig | undefined): Record<string, unknown> {
  if (!config) return { available: false }
  return {
    available: true,
    locale: config.locale,
    runtime: { mode: config.runtime.scrcpyPath ? 'custom' : 'bundled' },
    counts: {
      profiles: config.profiles.length,
      knownDeviceAliases: Object.keys(config.deviceAliases).length,
      wirelessTargets: config.wirelessTargets.length,
      automations: config.automations.length
    },
    settings: {
      minimizeToTray: config.minimizeToTray,
      killAdbOnQuit: config.killAdbOnQuit,
      autoSelectFirstDevice: config.autoSelectFirstDevice,
      bossKeyEnabled: config.bossKeyEnabled,
      muteNotifications: config.muteNotifications
    }
  }
}

const descriptions: Record<string, string> = {
  'diagnostic-manifest.json': 'Bundle schema, generation time, included files, and redaction summary.',
  'environment.json': 'Application, Electron, operating-system, scrcpy, ADB, and capability summary.',
  'devices.json': 'Current ADB device snapshot with stable hashed identifiers.',
  'sessions.json': 'Current application session history, final argv, states, timings, and exit information.',
  'events.json': 'Recent structured application events.',
  'config-summary.json': 'Non-sensitive setting modes and object counts; no automation text or wireless addresses.',
  'README.txt': 'Review and issue-attachment instructions.'
}

function entriesFor(context: DiagnosticContext, eventLimit: number): { entries: ZipEntry[]; summary: RedactionSummary } {
  const serials = new Set([
    ...context.devices.map((device) => device.serial),
    ...context.sessions.map((session) => session.serialAtLaunch)
  ])
  const addresses = context.config?.wirelessTargets.map((target) => target.address) || []
  const localPaths = context.config ? [
    context.config.runtime.scrcpyPath,
    context.config.launch.recordPath,
    context.config.launch.recordDirectory
  ].filter(Boolean) : []
  const summary: RedactionSummary = { counts: new Map(), replacements: [], addressTokens: new Map() }
  if (context.userDataPath) summary.replacements.push({ source: context.userDataPath, target: '$APP_DATA', kind: 'app-data-path' })
  if (context.homePath && context.homePath !== context.userDataPath) summary.replacements.push({ source: context.homePath, target: '$HOME', kind: 'home-path' })
  for (const serial of serials) summary.replacements.push({ source: serial, target: stableDeviceId(serial), kind: 'device-serial' })
  addresses.forEach((address, index) => summary.replacements.push({ source: address, target: `<device-address-${index + 1}>`, kind: 'device-address' }))
  localPaths.forEach((path) => summary.replacements.push({ source: path, target: '<local-path>', kind: 'local-path' }))
  summary.replacements.sort((left, right) => right.source.length - left.source.length)

  const environment = redactValue({
    app: { version: context.appVersion, electron: context.electronVersion, node: context.nodeVersion },
    os: { platform: context.platform, release: context.release, arch: context.arch },
    runtime: context.environment
  }, summary)
  const devices = redactValue(context.devices, summary)
  const sessions = redactValue(context.sessions, summary)
  const events = redactValue(context.events.slice(-eventLimit), summary)
  const config = redactValue(configSummary(context.config), summary)
  const dataEntries: ZipEntry[] = [
    { name: 'environment.json', data: json(environment) },
    { name: 'devices.json', data: json(devices) },
    { name: 'sessions.json', data: json(sessions) },
    { name: 'events.json', data: json(events) },
    { name: 'config-summary.json', data: json(config) },
    {
      name: 'README.txt',
      data: 'Review every file before attaching this bundle to a public issue.\nThe bundle is stored locally and is never uploaded by Scrcpy GUI.\n'
    }
  ]
  const manifest = {
    schemaVersion: 1,
    generatedAt: context.generatedAt,
    privacy: 'default-redacted',
    files: ['diagnostic-manifest.json', ...dataEntries.map((entry) => entry.name)].map((name) => ({ name, description: descriptions[name] })),
    redactions: [...summary.counts.entries()].map(([kind, count]) => ({ kind, count }))
  }
  return { entries: [{ name: 'diagnostic-manifest.json', data: json(manifest) }, ...dataEntries], summary }
}

export class DiagnosticsService {
  prepare(context: DiagnosticContext): PreparedDiagnostics {
    let eventLimit = Math.min(1_000, context.events.length)
    let built = entriesFor(context, eventLimit)
    let archive = createZip(built.entries, new Date(context.generatedAt))
    while (archive.length > MAX_DIAGNOSTIC_BYTES && eventLimit > 50) {
      eventLimit = Math.max(50, Math.floor(eventLimit / 2))
      built = entriesFor(context, eventLimit)
      archive = createZip(built.entries, new Date(context.generatedAt))
    }
    if (archive.length > MAX_DIAGNOSTIC_BYTES) throw new Error('Diagnostic bundle exceeds the 20 MiB safety limit.')
    const preview: DiagnosticPreview = {
      files: built.entries.map((entry) => ({
        name: entry.name,
        description: descriptions[entry.name],
        bytes: Buffer.isBuffer(entry.data) ? entry.data.length : Buffer.byteLength(entry.data)
      })),
      redactions: [...built.summary.counts.entries()].map(([kind, count]) => ({ kind, count })),
      estimatedBytes: archive.length,
      maxBytes: MAX_DIAGNOSTIC_BYTES,
      eventCount: eventLimit
    }
    return { preview, archive }
  }

  async write(path: string, prepared: PreparedDiagnostics): Promise<void> {
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
    await mkdir(dirname(path), { recursive: true })
    try {
      const handle = await open(temporaryPath, 'wx', 0o600)
      try {
        await handle.writeFile(prepared.archive)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporaryPath, path)
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw error
    }
  }
}

export const diagnosticsService = new DiagnosticsService()

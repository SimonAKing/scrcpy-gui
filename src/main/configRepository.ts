import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, copyFile, mkdir, open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AppConfigV3,
  AutomationMacro,
  ConfigLoadResult,
  ConfigMigrationReport,
  ConfigSaveResult,
  DeviceGroup,
  DeviceGroupView,
  KnownDevice,
  LaunchProfile,
  JsonValue,
  Locale,
  OperationResult,
  PersistedConfig,
  WirelessTarget
} from '../shared/types'
import { configView, defaultPersistedConfig, legacyConfigView } from '../shared/config'
import { automationMacro, boundedString, launchConfig, runtimeConfig, strictBoolean } from './ipcValidation'
import { validateDeviceAddress } from './scrcpy'
import { failureFromUnknown, operationFailure } from '../shared/errors'
import { readBoundedRegularUtf8File } from './safeFile'

const MAX_CONFIG_BYTES = 2 * 1024 * 1024
const MAX_COLLECTION_SIZE = 1_000
const locales = new Set<Locale>(['en', 'zh-CN', 'zh-TW', 'ru'])

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`)
  return value as Record<string, unknown>
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_SIZE) {
    throw new TypeError(`${name} must be an array with at most ${MAX_COLLECTION_SIZE} items.`)
  }
  return value
}

function integer(value: unknown, name: string, min = 0): number {
  if (!Number.isInteger(value) || Number(value) < min) throw new TypeError(`${name} must be an integer of at least ${min}.`)
  return Number(value)
}

function locale(value: unknown, fallback?: Locale): Locale {
  if (typeof value === 'string' && locales.has(value as Locale)) return value as Locale
  if (fallback) return fallback
  throw new TypeError('locale is not supported.')
}

function stringRecord(value: unknown, name: string, booleanValues = false): Record<string, string | boolean> {
  const source = object(value, name)
  if (Object.keys(source).length > MAX_COLLECTION_SIZE) throw new TypeError(`${name} has too many entries.`)
  const result: Record<string, string | boolean> = {}
  for (const [key, item] of Object.entries(source)) {
    const safeKey = boundedString(key, `${name} key`, 512)
    result[safeKey] = booleanValues
      ? strictBoolean(item, `${name}.${safeKey}`)
      : boundedString(item, `${name}.${safeKey}`, 512, true)
  }
  return result
}

export function validateLaunchProfile(value: unknown, name = 'profile'): LaunchProfile {
  const source = object(value, name)
  return {
    id: boundedString(source.id, `${name}.id`, 128),
    name: boundedString(source.name, `${name}.name`, 128),
    launch: launchConfig(source.launch),
    extensions: source.extensions === undefined ? undefined : validateExtensions(source.extensions, `${name}.extensions`)
  }
}

function jsonValue(value: unknown, name: string, depth = 0): JsonValue {
  if (depth > 10) throw new TypeError(`${name} is nested too deeply.`)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw new TypeError(`${name} contains too many items.`)
    return value.map((item, index) => jsonValue(item, `${name}[${index}]`, depth + 1))
  }
  const source = object(value, name)
  if (Object.keys(source).length > 1_000) throw new TypeError(`${name} contains too many fields.`)
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [
    boundedString(key, `${name} key`, 128),
    jsonValue(item, `${name}.${key}`, depth + 1)
  ]))
}

export function validateExtensions(value: unknown, name = 'extensions'): Record<string, JsonValue> {
  object(value, name)
  if (Buffer.byteLength(JSON.stringify(value)) > 64 * 1024) throw new TypeError(`${name} exceeds the 64 KiB limit.`)
  return jsonValue(value, name) as Record<string, JsonValue>
}

function assertUnique<T>(items: T[], value: (item: T) => string, name: string): void {
  const seen = new Set<string>()
  for (const item of items) {
    const key = value(item)
    if (seen.has(key)) throw new TypeError(`${name} contains duplicate ${key}.`)
    seen.add(key)
  }
}

function wirelessTarget(value: unknown, name: string): WirelessTarget {
  const source = object(value, name)
  const address = boundedString(source.address, `${name}.address`, 512)
  if (!validateDeviceAddress(address)) throw new TypeError(`${name}.address is invalid.`)
  return {
    id: boundedString(source.id, `${name}.id`, 128),
    name: boundedString(source.name, `${name}.name`, 128, true),
    address,
    autoConnect: strictBoolean(source.autoConnect, `${name}.autoConnect`)
  }
}

function automation(value: unknown, name: string): AutomationMacro {
  return automationMacro(value, name)
}

function groupView(value: unknown, name: string): DeviceGroupView {
  const source = object(value, name)
  const concurrencyLimit = source.concurrencyLimit === undefined ? 3 : integer(source.concurrencyLimit, `${name}.concurrencyLimit`, 1)
  if (concurrencyLimit > 8) throw new TypeError(`${name}.concurrencyLimit may not exceed 8.`)
  return {
    id: boundedString(source.id, `${name}.id`, 128),
    name: boundedString(source.name, `${name}.name`, 128),
    serials: array(source.serials, `${name}.serials`).map((item, index) => boundedString(item, `${name}.serials[${index}]`, 512)),
    defaultProfileId: source.defaultProfileId === undefined || source.defaultProfileId === ''
      ? undefined
      : boundedString(source.defaultProfileId, `${name}.defaultProfileId`, 128),
    concurrencyLimit,
    description: source.description === undefined ? '' : boundedString(source.description, `${name}.description`, 1_024, true)
  }
}

export function validatePersistedConfig(value: unknown): PersistedConfig {
  const source = object(value, 'config')
  const configLocale = locale(source.locale)
  const profiles = array(source.profiles, 'config.profiles').map((item, index) => validateLaunchProfile(item, `config.profiles[${index}]`))
  assertUnique(profiles, (item) => item.id, 'config.profiles')
  const wirelessTargets = array(source.wirelessTargets, 'config.wirelessTargets').map((item, index) => wirelessTarget(item, `config.wirelessTargets[${index}]`))
  const automations = array(source.automations, 'config.automations').map((item, index) => automation(item, `config.automations[${index}]`))
  const groups = array(source.groups, 'config.groups').map((item, index) => groupView(item, `config.groups[${index}]`))
  assertUnique(wirelessTargets, (item) => item.id, 'config.wirelessTargets')
  assertUnique(automations, (item) => item.id, 'config.automations')
  assertUnique(groups, (item) => item.id, 'config.groups')
  const profileIds = new Set(profiles.map((item) => item.id))
  const deviceProfiles = stringRecord(source.deviceProfiles, 'config.deviceProfiles') as Record<string, string>
  for (const profileId of Object.values(deviceProfiles)) {
    if (profileId && !profileIds.has(profileId)) throw new TypeError('config.deviceProfiles references an unknown profile.')
  }
  for (const group of groups) {
    if (group.defaultProfileId && !profileIds.has(group.defaultProfileId)) throw new TypeError('config.groups references an unknown profile.')
    if (new Set(group.serials).size !== group.serials.length) throw new TypeError('config.groups contains duplicate device serials.')
  }
  return {
    runtime: runtimeConfig(source.runtime),
    launch: launchConfig(source.launch),
    profiles,
    deviceProfiles,
    deviceAliases: stringRecord(source.deviceAliases, 'config.deviceAliases') as Record<string, string>,
    wirelessTargets,
    automations,
    groups,
    locale: configLocale,
    muteNotifications: strictBoolean(source.muteNotifications, 'config.muteNotifications'),
    minimizeToTray: strictBoolean(source.minimizeToTray, 'config.minimizeToTray'),
    killAdbOnQuit: strictBoolean(source.killAdbOnQuit, 'config.killAdbOnQuit'),
    bossKeyEnabled: strictBoolean(source.bossKeyEnabled, 'config.bossKeyEnabled'),
    bossKeyAccelerator: boundedString(source.bossKeyAccelerator, 'config.bossKeyAccelerator', 128),
    autoSelectFirstDevice: strictBoolean(source.autoSelectFirstDevice, 'config.autoSelectFirstDevice'),
    autoLaunchDevices: stringRecord(source.autoLaunchDevices, 'config.autoLaunchDevices', true) as Record<string, boolean>
  }
}

function safeLegacyConfig(value: unknown, fallbackLocale: Locale): { config: PersistedConfig; report: ConfigMigrationReport } {
  const defaults = defaultPersistedConfig(fallbackLocale)
  const candidate = legacyConfigView(value, fallbackLocale)
  let imported = 0
  let skipped = 0
  let invalid = 0
  const accept = <T>(factory: () => T, fallback: T): T => {
    try { const result = factory(); imported += 1; return result } catch { invalid += 1; return fallback }
  }
  const acceptItems = <T>(values: unknown, factory: (value: unknown, index: number) => T): T[] => {
    if (!Array.isArray(values)) return []
    const result: T[] = []
    for (const [index, item] of values.slice(0, MAX_COLLECTION_SIZE).entries()) {
      try { result.push(factory(item, index)); imported += 1 } catch { skipped += 1 }
    }
    if (values.length > MAX_COLLECTION_SIZE) skipped += values.length - MAX_COLLECTION_SIZE
    return result
  }
  const dedupe = <T>(items: T[], key: (item: T) => string): T[] => {
    const seen = new Set<string>()
    return items.filter((item) => {
      const value = key(item)
      if (seen.has(value)) { skipped += 1; return false }
      seen.add(value)
      return true
    })
  }
  const profiles = dedupe(acceptItems(candidate.profiles, (item, index) => validateLaunchProfile(item, `legacy.profiles[${index}]`)), (item) => item.id)
  const profileIds = new Set(profiles.map((item) => item.id))
  const deviceProfiles: Record<string, string> = {}
  try {
    for (const [serial, profileId] of Object.entries(stringRecord(candidate.deviceProfiles, 'legacy.deviceProfiles'))) {
      if (profileId && profileIds.has(String(profileId))) deviceProfiles[serial] = String(profileId)
      else skipped += 1
    }
  } catch { invalid += 1 }
  return {
    config: {
      runtime: accept(() => runtimeConfig(candidate.runtime), defaults.runtime),
      launch: accept(() => launchConfig(candidate.launch), defaults.launch),
      profiles,
      deviceProfiles,
      deviceAliases: accept(() => stringRecord(candidate.deviceAliases, 'legacy.deviceAliases') as Record<string, string>, {}),
      wirelessTargets: dedupe(acceptItems(candidate.wirelessTargets, (item, index) => wirelessTarget(item, `legacy.wirelessTargets[${index}]`)), (item) => item.id),
      automations: dedupe(acceptItems(candidate.automations, (item, index) => automation(item, `legacy.automations[${index}]`)), (item) => item.id),
      groups: dedupe(acceptItems(candidate.groups, (item, index) => groupView(item, `legacy.groups[${index}]`)), (item) => item.id),
      locale: locale(candidate.locale, fallbackLocale),
      muteNotifications: accept(() => strictBoolean(candidate.muteNotifications, 'legacy.muteNotifications'), defaults.muteNotifications),
      minimizeToTray: accept(() => strictBoolean(candidate.minimizeToTray, 'legacy.minimizeToTray'), defaults.minimizeToTray),
      killAdbOnQuit: accept(() => strictBoolean(candidate.killAdbOnQuit, 'legacy.killAdbOnQuit'), defaults.killAdbOnQuit),
      bossKeyEnabled: accept(() => strictBoolean(candidate.bossKeyEnabled, 'legacy.bossKeyEnabled'), defaults.bossKeyEnabled),
      bossKeyAccelerator: accept(() => boundedString(candidate.bossKeyAccelerator, 'legacy.bossKeyAccelerator', 128), defaults.bossKeyAccelerator),
      autoSelectFirstDevice: accept(() => strictBoolean(candidate.autoSelectFirstDevice, 'legacy.autoSelectFirstDevice'), defaults.autoSelectFirstDevice),
      autoLaunchDevices: accept(() => stringRecord(candidate.autoLaunchDevices, 'legacy.autoLaunchDevices', true) as Record<string, boolean>, {})
    },
    report: { source: 'legacy-v2', imported, skipped, invalid }
  }
}

function deviceId(serial: string): string {
  return `device-${createHash('sha256').update(serial).digest('hex').slice(0, 16)}`
}

function configFromView(view: PersistedConfig, revision: number, previous: AppConfigV3 | undefined, now: string): AppConfigV3 {
  const previousDevices = new Map(previous?.knownDevices.map((device) => [device.lastSerial, device]) || [])
  const serials = new Set([
    ...Object.keys(view.deviceAliases), ...Object.keys(view.deviceProfiles), ...Object.keys(view.autoLaunchDevices),
    ...view.groups.flatMap((group) => group.serials),
    ...(previous?.knownDevices.map((device) => device.lastSerial) || [])
  ])
  const knownDevices: KnownDevice[] = [...serials].map((serial) => {
    const existing = previousDevices.get(serial)
    return {
      id: existing?.id || deviceId(serial), lastSerial: serial, alias: view.deviceAliases[serial] || '',
      model: existing?.model || '', lastConnection: serial.includes(':') ? 'wireless' : 'usb',
      defaultProfileId: view.deviceProfiles[serial] || undefined, groupIds: existing?.groupIds || [],
      autoConnect: existing?.autoConnect || false, autoLaunch: view.autoLaunchDevices[serial] || false,
      firstSeenAt: existing?.firstSeenAt || now, lastSeenAt: existing?.lastSeenAt || now
    }
  })
  const idBySerial = new Map(knownDevices.map((device) => [device.lastSerial, device.id]))
  const groups: DeviceGroup[] = view.groups.map((group) => ({
    id: group.id,
    name: group.name,
    deviceIds: group.serials.map((serial) => idBySerial.get(serial)).filter(Boolean) as string[],
    defaultProfileId: group.defaultProfileId,
    concurrencyLimit: group.concurrencyLimit,
    description: group.description
  }))
  const groupIdsByDevice = new Map<string, string[]>()
  for (const group of groups) {
    for (const id of group.deviceIds) groupIdsByDevice.set(id, [...(groupIdsByDevice.get(id) || []), group.id])
  }
  for (const device of knownDevices) device.groupIds = groupIdsByDevice.get(device.id) || []
  return {
    schemaVersion: 3, revision, locale: view.locale,
    appearance: { muteNotifications: view.muteNotifications },
    runtime: { mode: view.runtime.scrcpyPath ? 'custom' : 'bundled', customScrcpyPath: view.runtime.scrcpyPath },
    defaults: {
      launch: structuredClone(view.launch), minimizeToTray: view.minimizeToTray,
      killAdbOnQuit: view.killAdbOnQuit, autoSelectFirstDevice: view.autoSelectFirstDevice
    },
    shortcuts: { bossKeyEnabled: view.bossKeyEnabled, bossKeyAccelerator: view.bossKeyAccelerator },
    knownDevices, profiles: structuredClone(view.profiles), wirelessTargets: structuredClone(view.wirelessTargets),
    automations: structuredClone(view.automations), groups
  }
}

function knownDevice(value: unknown, name: string): KnownDevice {
  const source = object(value, name)
  const lastConnection = source.lastConnection
  if (lastConnection !== 'usb' && lastConnection !== 'wireless') throw new TypeError(`${name}.lastConnection is invalid.`)
  return {
    id: boundedString(source.id, `${name}.id`, 128), lastSerial: boundedString(source.lastSerial, `${name}.lastSerial`, 512),
    alias: boundedString(source.alias, `${name}.alias`, 128, true), model: boundedString(source.model, `${name}.model`, 128, true),
    lastConnection, defaultProfileId: source.defaultProfileId === undefined ? undefined : boundedString(source.defaultProfileId, `${name}.defaultProfileId`, 128),
    groupIds: array(source.groupIds, `${name}.groupIds`).map((item, index) => boundedString(item, `${name}.groupIds[${index}]`, 128)),
    autoConnect: strictBoolean(source.autoConnect, `${name}.autoConnect`), autoLaunch: strictBoolean(source.autoLaunch, `${name}.autoLaunch`),
    firstSeenAt: boundedString(source.firstSeenAt, `${name}.firstSeenAt`, 64), lastSeenAt: boundedString(source.lastSeenAt, `${name}.lastSeenAt`, 64)
  }
}

function group(value: unknown, name: string): DeviceGroup {
  const source = object(value, name)
  const concurrencyLimit = source.concurrencyLimit === undefined ? 3 : integer(source.concurrencyLimit, `${name}.concurrencyLimit`, 1)
  if (concurrencyLimit > 8) throw new TypeError(`${name}.concurrencyLimit may not exceed 8.`)
  return {
    id: boundedString(source.id, `${name}.id`, 128), name: boundedString(source.name, `${name}.name`, 128),
    deviceIds: array(source.deviceIds, `${name}.deviceIds`).map((item, index) => boundedString(item, `${name}.deviceIds[${index}]`, 128)),
    defaultProfileId: source.defaultProfileId === undefined ? undefined : boundedString(source.defaultProfileId, `${name}.defaultProfileId`, 128),
    concurrencyLimit,
    description: source.description === undefined ? '' : boundedString(source.description, `${name}.description`, 1_024, true)
  }
}

export function validateAppConfigV3(value: unknown): AppConfigV3 {
  const source = object(value, 'configV3')
  if (source.schemaVersion !== 3) throw new TypeError('Unsupported config schema version.')
  const appearance = object(source.appearance, 'configV3.appearance')
  const runtime = object(source.runtime, 'configV3.runtime')
  const defaults = object(source.defaults, 'configV3.defaults')
  const shortcuts = object(source.shortcuts, 'configV3.shortcuts')
  const configLocale = locale(source.locale)
  if (runtime.mode !== 'bundled' && runtime.mode !== 'custom') throw new TypeError('configV3.runtime.mode is invalid.')
  const profiles = array(source.profiles, 'configV3.profiles').map((item, index) => validateLaunchProfile(item, `configV3.profiles[${index}]`))
  const profileIds = new Set(profiles.map((item) => item.id))
  const knownDevices = array(source.knownDevices, 'configV3.knownDevices').map((item, index) => knownDevice(item, `configV3.knownDevices[${index}]`))
  const wirelessTargets = array(source.wirelessTargets, 'configV3.wirelessTargets').map((item, index) => wirelessTarget(item, `configV3.wirelessTargets[${index}]`))
  const automations = array(source.automations, 'configV3.automations').map((item, index) => automation(item, `configV3.automations[${index}]`))
  const groups = array(source.groups, 'configV3.groups').map((item, index) => group(item, `configV3.groups[${index}]`))
  assertUnique(profiles, (item) => item.id, 'configV3.profiles')
  assertUnique(knownDevices, (item) => item.id, 'configV3.knownDevices')
  assertUnique(knownDevices, (item) => item.lastSerial, 'configV3 known device serials')
  assertUnique(wirelessTargets, (item) => item.id, 'configV3.wirelessTargets')
  assertUnique(automations, (item) => item.id, 'configV3.automations')
  assertUnique(groups, (item) => item.id, 'configV3.groups')
  const groupIds = new Set(groups.map((item) => item.id))
  const deviceIds = new Set(knownDevices.map((item) => item.id))
  for (const device of knownDevices) {
    if (device.defaultProfileId && !profileIds.has(device.defaultProfileId)) throw new TypeError('A known device references an unknown profile.')
    if (device.groupIds.some((id) => !groupIds.has(id))) throw new TypeError('A known device references an unknown group.')
  }
  if (groups.some((item) => item.deviceIds.some((id) => !deviceIds.has(id)))) throw new TypeError('A group references an unknown device.')
  if (groups.some((item) => item.defaultProfileId && !profileIds.has(item.defaultProfileId))) throw new TypeError('A group references an unknown profile.')
  if (groups.some((item) => new Set(item.deviceIds).size !== item.deviceIds.length)) throw new TypeError('A group contains duplicate devices.')
  return {
    schemaVersion: 3, revision: integer(source.revision, 'configV3.revision'), locale: configLocale,
    appearance: { muteNotifications: strictBoolean(appearance.muteNotifications, 'configV3.appearance.muteNotifications') },
    runtime: {
      mode: runtime.mode,
      customScrcpyPath: runtime.mode === 'bundled'
        ? ''
        : boundedString(runtime.customScrcpyPath, 'configV3.runtime.customScrcpyPath', 4096)
    },
    defaults: {
      launch: launchConfig(defaults.launch), minimizeToTray: strictBoolean(defaults.minimizeToTray, 'configV3.defaults.minimizeToTray'),
      killAdbOnQuit: strictBoolean(defaults.killAdbOnQuit, 'configV3.defaults.killAdbOnQuit'),
      autoSelectFirstDevice: strictBoolean(defaults.autoSelectFirstDevice, 'configV3.defaults.autoSelectFirstDevice')
    },
    shortcuts: {
      bossKeyEnabled: strictBoolean(shortcuts.bossKeyEnabled, 'configV3.shortcuts.bossKeyEnabled'),
      bossKeyAccelerator: boundedString(shortcuts.bossKeyAccelerator, 'configV3.shortcuts.bossKeyAccelerator', 128)
    },
    knownDevices, profiles, wirelessTargets, automations, groups
  }
}

export class ConfigRepository {
  private readonly configPath: string
  private readonly backupPath: string
  private current?: AppConfigV3
  private loadPromise?: Promise<ConfigLoadResult>
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(private readonly directory: string, private readonly now = () => new Date()) {
    this.configPath = join(directory, 'config.json')
    this.backupPath = join(directory, 'config.backup.json')
  }

  load(legacyJson: string, fallbackLocale: Locale): Promise<ConfigLoadResult> {
    if (this.current) {
      return Promise.resolve(this.use(this.current, { source: 'existing-v3', imported: 0, skipped: 0, invalid: 0 }))
    }
    this.loadPromise ||= this.loadOnce(legacyJson, fallbackLocale)
    return this.loadPromise
  }

  snapshot(): PersistedConfig | undefined {
    return this.current ? structuredClone(configView(this.current)) : undefined
  }

  async save(expectedRevision: number, value: unknown): Promise<OperationResult<ConfigSaveResult>> {
    let resolveResult!: (result: OperationResult<ConfigSaveResult>) => void
    const result = new Promise<OperationResult<ConfigSaveResult>>((resolve) => { resolveResult = resolve })
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        if (!this.current) throw new Error('Configuration has not been loaded.')
        if (expectedRevision !== this.current.revision) {
          resolveResult(operationFailure(
            'CONFIG_REVISION_CONFLICT',
            'config-save',
            `Configuration changed; expected revision ${expectedRevision}, current revision is ${this.current.revision}.`,
            { retryable: true, suggestedActions: ['Reload the latest configuration and retry the change.'] }
          ))
          return
        }
        const view = validatePersistedConfig(value)
        const next = validateAppConfigV3(configFromView(view, this.current.revision + 1, this.current, this.now().toISOString()))
        await this.atomicWrite(next, true)
        this.current = next
        resolveResult({ ok: true, data: { config: configView(next), revision: next.revision } })
      } catch (error) {
        resolveResult(failureFromUnknown(
          error,
          'CONFIG_SAVE_FAILED',
          'config-save',
          'Unable to save the configuration.',
          { retryable: true, suggestedActions: ['Retry the change after checking available disk space.'] }
        ))
      }
    })
    await this.saveQueue
    return result
  }

  private async loadOnce(legacyJson: string, fallbackLocale: Locale): Promise<ConfigLoadResult> {
    await mkdir(this.directory, { recursive: true })
    const primary = await this.readValidated(this.configPath)
    if (primary) return this.use(primary, { source: 'existing-v3', imported: 0, skipped: 0, invalid: 0 })
    const backup = await this.readValidated(this.backupPath)
    if (backup) {
      await this.atomicWrite(backup, false)
      return this.use(backup, { source: 'backup', imported: 0, skipped: 0, invalid: 1 })
    }

    let legacy: unknown = {}
    let source: ConfigMigrationReport['source'] = 'defaults'
    if (legacyJson) {
      if (Buffer.byteLength(legacyJson) > MAX_CONFIG_BYTES) throw new TypeError('Legacy configuration exceeds the 2 MB limit.')
      try { legacy = JSON.parse(legacyJson); source = 'legacy-v2' } catch { legacy = {}; source = 'defaults' }
    }
    const migrated = safeLegacyConfig(legacy, fallbackLocale)
    migrated.report.source = source
    const config = validateAppConfigV3(configFromView(migrated.config, 1, undefined, this.now().toISOString()))
    await this.atomicWrite(config, false)
    return this.use(config, migrated.report)
  }

  private use(config: AppConfigV3, migration: ConfigMigrationReport): ConfigLoadResult {
    this.current = config
    return { config: configView(config), revision: config.revision, migration }
  }

  private async readValidated(path: string): Promise<AppConfigV3 | undefined> {
    let contents: string
    try {
      contents = await readBoundedRegularUtf8File(
        path,
        MAX_CONFIG_BYTES,
        'Configuration must be a regular file no larger than 2 MiB.'
      )
    } catch {
      return undefined
    }
    let parsed: unknown
    try { parsed = JSON.parse(contents) } catch { return undefined }
    const schemaVersion = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).schemaVersion
      : undefined
    if (typeof schemaVersion === 'number' && schemaVersion > 3) {
      throw new Error(`Configuration schema ${schemaVersion} is newer than supported schema 3; the file was left unchanged.`)
    }
    try { return validateAppConfigV3(parsed) } catch { return undefined }
  }

  private async atomicWrite(config: AppConfigV3, rotateBackup: boolean): Promise<void> {
    const temporaryPath = `${this.configPath}.${process.pid}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporaryPath, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      if (rotateBackup && await this.exists(this.configPath)) await copyFile(this.configPath, this.backupPath)
      await rename(temporaryPath, this.configPath)
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw error
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }
}

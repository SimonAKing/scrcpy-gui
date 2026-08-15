import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  LaunchConfig,
  LaunchProfile,
  Locale,
  ProfileImportCommit,
  ProfileImportPreview,
  ProfileImportStrategy
} from '../shared/types'
import { normalizedLaunch } from '../shared/config'
import { analyzeExpertArgs } from '../shared/options'
import { launchConfig } from './ipcValidation'
import { validateExtensions } from './configRepository'

const MAX_PROFILE_BYTES = 2 * 1024 * 1024
const CURRENT_SCRCPY_VERSION = '4.1'
const knownDocumentFields = new Set(['schemaVersion', 'kind', 'appVersion', 'minScrcpyVersion', 'profile'])
const knownProfileFields = new Set(['name', 'scene', 'options', 'expertArgs', 'extensions', 'machineLocalFields'])
const knownOptionFields = new Set(Object.keys(normalizedLaunch()).filter((key) => key !== 'extraArgs'))

interface PendingProfile {
  expiresAt: number
  profile: LaunchProfile
  appVersion: string
  minScrcpyVersion: string
  machineLocalPaths: ProfileImportPreview['machineLocalPaths']
  unknownFields: string[]
  warnings: string[]
  locale: Locale
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`)
  return value as Record<string, unknown>
}

function boundedString(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    throw new TypeError(`${name} must be a non-empty string of at most ${max} characters.`)
  }
  return value.trim()
}

function version(value: unknown, name: string): string {
  const result = boundedString(value, name, 32)
  if (!/^\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?$/.test(result)) throw new TypeError(`${name} is not a supported version.`)
  return result
}

function compareVersions(left: string, right: string): number {
  const values = (input: string): number[] => input.split('-')[0].split('.').map(Number)
  const a = values(left)
  const b = values(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0)
  }
  return 0
}

function nameKey(value: string, locale: Locale): string {
  return value.trim().toLocaleLowerCase(locale)
}

function conflictFor(name: string, profiles: LaunchProfile[], locale: Locale): LaunchProfile | undefined {
  const key = nameKey(name, locale)
  return profiles.find((profile) => nameKey(profile.name, locale) === key)
}

function duplicateName(name: string, profiles: LaunchProfile[], locale: Locale): string {
  const existing = new Set(profiles.map((profile) => nameKey(profile.name, locale)))
  if (!existing.has(nameKey(name, locale))) return name
  for (let index = 2; index < 10_000; index += 1) {
    const suffix = ` (${index})`
    const candidate = `${name.slice(0, 80 - suffix.length).trimEnd()}${suffix}`
    if (!existing.has(nameKey(candidate, locale))) return candidate
  }
  throw new Error('Unable to generate a unique profile name.')
}

function expertArgs(value: unknown): string {
  if (!Array.isArray(value) || value.length > 200 || value.some((item) =>
    typeof item !== 'string' || !item.trim() || item.length > 4_096 || /[\r\n\0]/.test(item)
  )) throw new TypeError('profile.expertArgs must contain at most 200 single-line arguments.')
  return analyzeExpertArgs(value.join('\n')).args.join('\n')
}

function unknownKeys(source: Record<string, unknown>, known: Set<string>, prefix: string): string[] {
  return Object.keys(source).filter((key) => !known.has(key)).map((key) => `${prefix}${key}`)
}

export class ProfileTransferService {
  private readonly pending = new Map<string, PendingProfile>()

  constructor(private readonly now = () => Date.now()) {}

  serialize(profile: LaunchProfile, appVersion: string): string {
    const launch = launchConfig(profile.launch)
    const args = analyzeExpertArgs(launch.extraArgs).args
    const { extraArgs: _extraArgs, ...options } = structuredClone(launch)
    const machineLocalFields = [
      ...(launch.recordPath ? ['profile.options.recordPath'] : []),
      ...(launch.recordDirectory ? ['profile.options.recordDirectory'] : [])
    ]
    return `${JSON.stringify({
      schemaVersion: 1,
      kind: 'scrcpy-gui-profile',
      appVersion,
      minScrcpyVersion: '4.0',
      profile: {
        name: boundedString(profile.name, 'profile.name', 80),
        scene: 'screen',
        options,
        expertArgs: args,
        extensions: structuredClone(profile.extensions || {}),
        machineLocalFields
      }
    }, null, 2)}\n`
  }

  preview(
    contents: string,
    existingProfiles: LaunchProfile[],
    locale: Locale,
    currentScrcpyVersion = CURRENT_SCRCPY_VERSION
  ): ProfileImportPreview {
    for (const [token, pending] of this.pending) {
      if (pending.expiresAt < this.now()) this.pending.delete(token)
    }
    if (this.pending.size >= 20) this.pending.delete(this.pending.keys().next().value as string)
    if (Buffer.byteLength(contents) > MAX_PROFILE_BYTES) throw new TypeError('Profile file exceeds the 2 MiB limit.')
    let value: unknown
    try { value = JSON.parse(contents) } catch { throw new TypeError('Profile file is not valid JSON.') }
    const document = record(value, 'profile document')
    if (document.schemaVersion !== 1 || document.kind !== 'scrcpy-gui-profile') {
      throw new TypeError('Unsupported profile document schema or kind.')
    }
    const appVersion = version(document.appVersion, 'profile document appVersion')
    const minScrcpyVersion = version(document.minScrcpyVersion, 'profile document minScrcpyVersion')
    const rawProfile = record(document.profile, 'profile')
    const name = boundedString(rawProfile.name, 'profile.name', 80)
    if (rawProfile.scene !== 'screen') throw new TypeError('Only the screen scene can be imported by this version.')
    const rawOptions = record(rawProfile.options, 'profile.options')
    const extraArgs = expertArgs(rawProfile.expertArgs)
    const launch = launchConfig({ ...normalizedLaunch(rawOptions as Partial<LaunchConfig>), extraArgs })
    const extensions = rawProfile.extensions === undefined
      ? undefined
      : validateExtensions(rawProfile.extensions, 'profile.extensions')
    const unknownFields = [
      ...unknownKeys(document, knownDocumentFields, ''),
      ...unknownKeys(rawProfile, knownProfileFields, 'profile.'),
      ...unknownKeys(rawOptions, knownOptionFields, 'profile.options.')
    ]
    const machineLocalPaths: ProfileImportPreview['machineLocalPaths'] = [
      ...(launch.recordPath ? [{ field: 'recordPath' as const, value: launch.recordPath }] : []),
      ...(launch.recordDirectory ? [{ field: 'recordDirectory' as const, value: launch.recordDirectory }] : [])
    ]
    const warnings = [
      ...(unknownFields.length ? [`${unknownFields.length} unknown fields will be reported and ignored.`] : []),
      ...(machineLocalPaths.length ? ['Machine-local recording paths are disabled by default during import.'] : []),
      ...(compareVersions(minScrcpyVersion, currentScrcpyVersion) > 0
        ? [`This profile requires scrcpy ${minScrcpyVersion}; the selected runtime is ${currentScrcpyVersion}.`]
        : [])
    ]
    const token = randomUUID()
    this.pending.set(token, {
      expiresAt: this.now() + 10 * 60_000,
      profile: { id: '', name, launch, extensions }, appVersion, minScrcpyVersion,
      machineLocalPaths, unknownFields, warnings, locale
    })
    const conflict = conflictFor(name, existingProfiles, locale)
    return {
      token, name, scene: 'screen', appVersion, minScrcpyVersion,
      compatible: compareVersions(minScrcpyVersion, currentScrcpyVersion) <= 0,
      warnings: [...warnings], unknownFields: [...unknownFields], machineLocalPaths: structuredClone(machineLocalPaths),
      conflict: conflict ? { profileId: conflict.id, name: conflict.name } : undefined
    }
  }

  commit(
    token: string,
    strategy: ProfileImportStrategy,
    keepMachinePaths: boolean,
    existingProfiles: LaunchProfile[]
  ): ProfileImportCommit {
    const pending = this.pending.get(token)
    this.pending.delete(token)
    if (!pending || pending.expiresAt < this.now()) throw new Error('Profile import preview expired; preview the file again.')
    if (strategy !== 'keep' && strategy !== 'replace' && strategy !== 'duplicate') throw new TypeError('Profile import strategy is invalid.')
    if (typeof keepMachinePaths !== 'boolean') throw new TypeError('keepMachinePaths must be a boolean.')
    const conflict = conflictFor(pending.profile.name, existingProfiles, pending.locale)
    if (strategy === 'keep' && conflict) return { keptExisting: true, replacedProfileId: conflict.id }
    const launch = structuredClone(pending.profile.launch)
    if (!keepMachinePaths) {
      launch.recordPath = ''
      launch.recordDirectory = ''
      launch.recordEnabled = false
      launch.autoRecordName = false
    }
    const replacing = strategy === 'replace' ? conflict : undefined
    const profile: LaunchProfile = {
      ...structuredClone(pending.profile),
      id: replacing?.id || randomUUID(),
      name: replacing ? replacing.name : duplicateName(pending.profile.name, existingProfiles, pending.locale),
      launch
    }
    return { profile, replacedProfileId: replacing?.id }
  }

  async write(path: string, contents: string): Promise<void> {
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
    await mkdir(dirname(path), { recursive: true })
    try {
      const handle = await open(temporaryPath, 'wx', 0o600)
      try {
        await handle.writeFile(contents, 'utf8')
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

export const profileTransferService = new ProfileTransferService()

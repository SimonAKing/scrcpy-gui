import type { CommandArgDetail, CommandArgSource, Device, DeviceState, LaunchConfig } from '../shared/types'
import { analyzeExpertArgs, serializeLaunchOptions, validatePortRange } from '../shared/options'
import { join } from 'node:path'

export { validatePortRange } from '../shared/options'

const HOST_LABEL = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/

export function isSupportedScrcpyVersion(version: string): boolean {
  const match = version.match(/\bscrcpy\s+(\d+)(?:\.|\b)/i)
  return Boolean(match && Number(match[1]) >= 4)
}

export function parseAdbDevices(output: string): Device[] {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial = '', stateValue = 'unknown', ...metadata] = line.split(/\s+/)
      const values = Object.fromEntries(
        metadata
          .map((entry) => entry.split(/:(.*)/s).slice(0, 2))
          .filter(([key, value]) => key && value)
      )
      const knownStates: DeviceState[] = ['device', 'offline', 'unauthorized', 'recovery']
      const state = knownStates.includes(stateValue as DeviceState)
        ? (stateValue as DeviceState)
        : 'unknown'

      return {
        serial,
        state,
        model: (values.model || serial).replaceAll('_', ' '),
        product: values.product || '',
        device: values.device || '',
        transportId: values.transport_id,
        connection: serial.includes(':') ? 'wireless' : 'usb'
      }
    })
}

function validPort(value: string): boolean {
  if (!/^\d{1,5}$/.test(value)) return false
  const port = Number(value)
  return port >= 1 && port <= 65535
}

function validIpv4(value: string): boolean {
  const octets = value.split('.')
  return octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
}

function validHostname(value: string): boolean {
  return value.length <= 253 && value.split('.').every((label) => HOST_LABEL.test(label))
}

export function validateDeviceAddress(value: string, requirePort = false): boolean {
  const target = value.trim()
  if (!target || /\s/.test(target)) return false

  if (target.startsWith('[')) {
    const match = target.match(/^\[([0-9a-fA-F:]+)](?::(\d{1,5}))?$/)
    if (!match || !match[1].includes(':')) return false
    return requirePort ? Boolean(match[2] && validPort(match[2])) : !match[2] || validPort(match[2])
  }

  const colonCount = (target.match(/:/g) || []).length
  if (colonCount > 1) return false
  const [host, port] = target.split(':')
  if (/^[\d.]+$/.test(host) && !validIpv4(host)) return false
  if (!validIpv4(host) && !validHostname(host)) return false
  if (requirePort) return Boolean(port && validPort(port))
  return !port || validPort(port)
}

export function splitExtraArgs(value: string): string[] {
  return analyzeExpertArgs(value).args
}

export function buildScrcpyArgDetails(
  config: LaunchConfig,
  serial: string,
  source: Extract<CommandArgSource, 'global' | 'profile'> = 'global',
  sourceLabel?: string,
  deviceWindowTitleOverride = false
): { args: string[]; details: CommandArgDetail[]; warnings: string[] } {
  if (!serial.trim()) throw new Error('A device serial is required.')
  const details: CommandArgDetail[] = [{ arg: `--serial=${serial}`, optionKey: 'serial', helpKey: 'device', source: 'session' }]
  for (const option of serializeLaunchOptions(config)) {
    for (const arg of option.args) {
      const optionSource: CommandArgSource = option.key === 'windowTitle' && deviceWindowTitleOverride
        ? 'device-override'
        : option.key === 'recording' && config.autoRecordName ? 'generated' : source
      details.push({
        arg, optionKey: option.key, helpKey: option.helpKey, source: optionSource,
        sourceLabel: optionSource === 'profile' ? sourceLabel : undefined
      })
    }
  }
  const expert = analyzeExpertArgs(config.extraArgs)
  details.push(...expert.args.map((arg) => ({ arg, optionKey: 'expertArgs', helpKey: 'extraArgs', source: 'expert' as const })))
  return { args: details.map((detail) => detail.arg), details, warnings: expert.warnings }
}

export function prepareLaunchConfig(config: LaunchConfig, serial: string, now = new Date()): LaunchConfig {
  if (!config.recordEnabled || !config.autoRecordName) return config
  if (!config.recordDirectory.trim()) throw new Error('Choose a recording folder for automatic filenames.')
  const safeSerial = serial.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'device'
  const timestamp = now.toISOString().replaceAll(':', '-').slice(0, 19)
  return { ...config, recordPath: join(config.recordDirectory.trim(), `scrcpy-${safeSerial}-${timestamp}.mp4`) }
}

export function buildScrcpyArgs(config: LaunchConfig, serial: string): string[] {
  return buildScrcpyArgDetails(config, serial).args
}

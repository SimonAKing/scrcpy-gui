import type {
  AutomationStep,
  CommandPreviewRequest,
  DeviceControlAction,
  DeviceLaunch,
  GamepadMode,
  KeyboardMode,
  LaunchConfig,
  MouseMode,
  Orientation,
  RuntimeConfig,
  ShortcutModifier,
  VideoCodec
} from '../shared/types'

const MAX_PATH_LENGTH = 4096
const MAX_SERIAL_LENGTH = 512
const MAX_EXTRA_ARGS_LENGTH = 65_536
const MAX_EXTRA_ARGS = 200
const MAX_AUTOMATION_STEPS = 200
const MAX_AUTOMATION_DURATION_MS = 30 * 60 * 1000

const orientations = new Set<Orientation>(['0', '90', '180', '270'])
const shortcutModifiers = new Set<ShortcutModifier>(['default', 'lctrl', 'rctrl', 'lalt', 'ralt', 'lsuper', 'rsuper'])
const keyboardModes = new Set<KeyboardMode>(['default', 'sdk', 'uhid', 'aoa'])
const mouseModes = new Set<MouseMode>(['default', 'sdk', 'uhid', 'aoa', 'disabled'])
const gamepadModes = new Set<GamepadMode>(['default', 'uhid', 'aoa'])
const videoCodecs = new Set<VideoCodec>(['default', 'h264', 'h265', 'av1', 'vp8', 'vp9'])
const previewSources = new Set<CommandPreviewRequest['source']>(['global', 'profile'])
const controlActions = new Set<DeviceControlAction>([
  'back', 'home', 'app-switch', 'menu', 'volume-up', 'volume-down', 'power', 'screen-on', 'screen-off',
  'rotate', 'auto-rotate', 'show-touches-on', 'show-touches-off'
])

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`)
  return value as Record<string, unknown>
}

export function boundedString(value: unknown, name: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string.`)
  if (value.includes('\0')) throw new TypeError(`${name} may not contain null bytes.`)
  if ((!allowEmpty && value.length === 0) || value.length > maxLength) {
    throw new TypeError(`${name} must contain ${allowEmpty ? '0' : '1'} to ${maxLength} characters.`)
  }
  return value
}

export function strictBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean.`)
  return value
}

export function nonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > Number.MAX_SAFE_INTEGER) {
    throw new TypeError(`${name} must be a non-negative safe integer.`)
  }
  return Number(value)
}

function finiteNumber(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`${name} must be a finite number from ${min} to ${max}.`)
  }
  return value
}

function enumValue<T extends string>(value: unknown, name: string, values: Set<T>): T {
  if (typeof value !== 'string' || !values.has(value as T)) throw new TypeError(`${name} is not supported.`)
  return value as T
}

function booleanField(source: Record<string, unknown>, key: keyof LaunchConfig): boolean {
  return strictBoolean(source[key], `launch.${key}`)
}

function geometry(value: unknown, name: 'crop' | 'window'): LaunchConfig[typeof name] {
  const source = record(value, `launch.${name}`)
  return {
    x: finiteNumber(source.x, `launch.${name}.x`, -32_768, 32_768),
    y: finiteNumber(source.y, `launch.${name}.y`, -32_768, 32_768),
    width: finiteNumber(source.width, `launch.${name}.width`, 0, 32_768),
    height: finiteNumber(source.height, `launch.${name}.height`, 0, 32_768)
  }
}

export function runtimeConfig(value: unknown): RuntimeConfig {
  const source = record(value, 'runtime')
  return { scrcpyPath: boundedString(source.scrcpyPath, 'runtime.scrcpyPath', MAX_PATH_LENGTH, true) }
}

export function deviceSerial(value: unknown): string {
  return boundedString(value, 'device serial', MAX_SERIAL_LENGTH)
}

export function controlAction(value: unknown): DeviceControlAction {
  return enumValue(value, 'device control action', controlActions)
}

export function launchConfig(value: unknown): LaunchConfig {
  const source = record(value, 'launch')
  const extraArgs = boundedString(source.extraArgs, 'launch.extraArgs', MAX_EXTRA_ARGS_LENGTH, true)
  const lines = extraArgs.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length > MAX_EXTRA_ARGS || lines.some((line) => line.length > 4096)) {
    throw new TypeError(`launch.extraArgs supports at most ${MAX_EXTRA_ARGS} lines of 4096 characters.`)
  }

  return {
    windowTitle: boundedString(source.windowTitle, 'launch.windowTitle', 256, true),
    videoBitRate: finiteNumber(source.videoBitRate, 'launch.videoBitRate', 0, 1000),
    videoBuffer: finiteNumber(source.videoBuffer, 'launch.videoBuffer', 0, 60_000),
    audioBuffer: finiteNumber(source.audioBuffer, 'launch.audioBuffer', 0, 60_000),
    maxSize: finiteNumber(source.maxSize, 'launch.maxSize', 0, 32_768),
    maxFps: finiteNumber(source.maxFps, 'launch.maxFps', 0, 1000),
    displayId: finiteNumber(source.displayId, 'launch.displayId', 0, 65_535),
    orientation: enumValue(source.orientation, 'launch.orientation', orientations),
    videoCodec: enumValue(source.videoCodec, 'launch.videoCodec', videoCodecs),
    shortcutModifier: enumValue(source.shortcutModifier, 'launch.shortcutModifier', shortcutModifiers),
    keyboardMode: enumValue(source.keyboardMode, 'launch.keyboardMode', keyboardModes),
    mouseMode: enumValue(source.mouseMode, 'launch.mouseMode', mouseModes),
    gamepadMode: enumValue(source.gamepadMode, 'launch.gamepadMode', gamepadModes),
    alwaysOnTop: booleanField(source, 'alwaysOnTop'),
    control: booleanField(source, 'control'),
    audio: booleanField(source, 'audio'),
    turnScreenOff: booleanField(source, 'turnScreenOff'),
    stayAwake: booleanField(source, 'stayAwake'),
    showTouches: booleanField(source, 'showTouches'),
    fullscreen: booleanField(source, 'fullscreen'),
    borderless: booleanField(source, 'borderless'),
    windowAspectRatioLock: booleanField(source, 'windowAspectRatioLock'),
    pushTarget: boundedString(source.pushTarget, 'launch.pushTarget', MAX_PATH_LENGTH, true),
    tunnelPort: boundedString(source.tunnelPort, 'launch.tunnelPort', 11, true),
    recordEnabled: booleanField(source, 'recordEnabled'),
    recordPath: boundedString(source.recordPath, 'launch.recordPath', MAX_PATH_LENGTH, true),
    autoRecordName: booleanField(source, 'autoRecordName'),
    recordDirectory: boundedString(source.recordDirectory, 'launch.recordDirectory', MAX_PATH_LENGTH, true),
    noPlayback: booleanField(source, 'noPlayback'),
    crop: geometry(source.crop, 'crop'),
    window: geometry(source.window, 'window'),
    extraArgs
  }
}

export function deviceLaunches(value: unknown): DeviceLaunch[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new TypeError('launches must contain 1 to 100 devices.')
  }
  return value.map((item, index) => {
    const source = record(item, `launches[${index}]`)
    return { serial: deviceSerial(source.serial), launch: launchConfig(source.launch) }
  })
}

export function commandPreviewRequests(value: unknown): CommandPreviewRequest[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new TypeError('preview requests must contain 1 to 100 devices.')
  }
  return value.map((item, index) => {
    const source = record(item, `preview[${index}]`)
    const previewSource = enumValue(source.source, `preview[${index}].source`, previewSources)
    const profileName = source.profileName === undefined
      ? undefined
      : boundedString(source.profileName, `preview[${index}].profileName`, 128, true)
    if (previewSource === 'profile' && !profileName) throw new TypeError(`preview[${index}].profileName is required for profile sources.`)
    return {
      serial: deviceSerial(source.serial), launch: launchConfig(source.launch), source: previewSource, profileName,
      deviceWindowTitleOverride: strictBoolean(source.deviceWindowTitleOverride, `preview[${index}].deviceWindowTitleOverride`)
    }
  })
}

export function automationSteps(value: unknown): AutomationStep[] {
  if (!Array.isArray(value) || value.length > MAX_AUTOMATION_STEPS) {
    throw new TypeError(`automation steps must contain 0 to ${MAX_AUTOMATION_STEPS} actions.`)
  }
  let totalDuration = 0
  const steps = value.map((item, index) => {
    const source = record(item, `steps[${index}]`)
    const delayMs = finiteNumber(source.delayMs, `steps[${index}].delayMs`, 0, 60_000)
    totalDuration += delayMs
    return { action: controlAction(source.action), delayMs }
  })
  if (totalDuration > MAX_AUTOMATION_DURATION_MS) throw new TypeError('automation duration may not exceed 30 minutes.')
  return steps
}

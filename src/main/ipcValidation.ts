import type {
  AutomationMacro,
  AutomationStep,
  AudioCodec,
  AudioSource,
  BatchPreflightRequest,
  CameraFacing,
  CommandPreviewRequest,
  DeviceControlAction,
  DeviceLaunch,
  GamepadMode,
  KeyboardMode,
  LaunchConfig,
  MouseMode,
  Orientation,
  RecordFormat,
  RecordOrientation,
  RuntimeConfig,
  SceneKind,
  ShortcutModifier,
  DisplayImePolicy,
  VideoCodec
} from '../shared/types'
import { normalizedLaunch } from '../shared/config'

const MAX_PATH_LENGTH = 4096
const MAX_SERIAL_LENGTH = 512
const MAX_EXTRA_ARGS_LENGTH = 65_536
const MAX_EXTRA_ARGS = 200
const MAX_AUTOMATION_STEPS = 200
const MAX_AUTOMATION_DURATION_MS = 30 * 60 * 1000
const PACKAGE_ID = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/
const SAFE_INPUT_TEXT = /^[\p{L}\p{N} .,_@%+\-/:?=]*$/u

const orientations = new Set<Orientation>(['0', '90', '180', '270'])
const recordOrientations = new Set<RecordOrientation>(['default', '0', '90', '180', '270'])
const scenes = new Set<SceneKind>(['screen', 'camera', 'virtual-display', 'record-only', 'control-only', 'otg'])
const shortcutModifiers = new Set<ShortcutModifier>(['default', 'lctrl', 'rctrl', 'lalt', 'ralt', 'lsuper', 'rsuper'])
const keyboardModes = new Set<KeyboardMode>(['default', 'sdk', 'uhid', 'aoa', 'disabled'])
const mouseModes = new Set<MouseMode>(['default', 'sdk', 'uhid', 'aoa', 'disabled'])
const gamepadModes = new Set<GamepadMode>(['default', 'uhid', 'aoa'])
const videoCodecs = new Set<VideoCodec>(['default', 'h264', 'h265', 'av1', 'vp8', 'vp9'])
const audioCodecs = new Set<AudioCodec>(['default', 'opus', 'aac', 'flac', 'raw'])
const audioSources = new Set<AudioSource>([
  'default', 'output', 'playback', 'mic', 'mic-unprocessed', 'mic-camcorder', 'mic-voice-recognition',
  'mic-voice-communication', 'voice-call', 'voice-call-uplink', 'voice-call-downlink', 'voice-performance'
])
const cameraFacings = new Set<CameraFacing>(['default', 'front', 'back', 'external'])
const recordFormats = new Set<RecordFormat>(['default', 'mp4', 'mkv', 'm4a', 'mka', 'opus', 'aac', 'flac', 'wav'])
const displayImePolicies = new Set<DisplayImePolicy>(['default', 'local'])
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

function size(value: unknown, name: 'cameraSize'): LaunchConfig[typeof name] {
  const source = record(value, `launch.${name}`)
  return {
    width: finiteNumber(source.width, `launch.${name}.width`, 0, 32_768),
    height: finiteNumber(source.height, `launch.${name}.height`, 0, 32_768)
  }
}

function virtualDisplay(value: unknown): LaunchConfig['virtualDisplay'] {
  const source = record(value, 'launch.virtualDisplay')
  return {
    width: finiteNumber(source.width, 'launch.virtualDisplay.width', 0, 32_768),
    height: finiteNumber(source.height, 'launch.virtualDisplay.height', 0, 32_768),
    dpi: finiteNumber(source.dpi, 'launch.virtualDisplay.dpi', 0, 2_000),
    systemDecorations: strictBoolean(source.systemDecorations, 'launch.virtualDisplay.systemDecorations'),
    destroyContent: strictBoolean(source.destroyContent, 'launch.virtualDisplay.destroyContent'),
    flexDisplay: strictBoolean(source.flexDisplay, 'launch.virtualDisplay.flexDisplay'),
    startApp: boundedString(source.startApp, 'launch.virtualDisplay.startApp', 512, true),
    keepActive: strictBoolean(source.keepActive, 'launch.virtualDisplay.keepActive'),
    imePolicy: enumValue(source.imePolicy, 'launch.virtualDisplay.imePolicy', displayImePolicies)
  }
}

export function runtimeConfig(value: unknown): RuntimeConfig {
  const source = record(value, 'runtime')
  return { scrcpyPath: boundedString(source.scrcpyPath, 'runtime.scrcpyPath', MAX_PATH_LENGTH, true) }
}

export function deviceSerial(value: unknown): string {
  return boundedString(value, 'device serial', MAX_SERIAL_LENGTH)
}

export function deviceSerials(value: unknown, max = 20): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) {
    throw new TypeError(`device serials must contain 1 to ${max} items.`)
  }
  return [...new Set(value.map((item) => deviceSerial(item)))]
}

export function controlAction(value: unknown): DeviceControlAction {
  return enumValue(value, 'device control action', controlActions)
}

export function launchConfig(value: unknown): LaunchConfig {
  const raw = record(value, 'launch')
  const source = normalizedLaunch(raw as Partial<LaunchConfig>) as unknown as Record<string, unknown>
  const extraArgs = boundedString(source.extraArgs, 'launch.extraArgs', MAX_EXTRA_ARGS_LENGTH, true)
  const lines = extraArgs.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length > MAX_EXTRA_ARGS || lines.some((line) => line.length > 4096)) {
    throw new TypeError(`launch.extraArgs supports at most ${MAX_EXTRA_ARGS} lines of 4096 characters.`)
  }

  return {
    scene: enumValue(source.scene, 'launch.scene', scenes),
    windowTitle: boundedString(source.windowTitle, 'launch.windowTitle', 256, true),
    videoBitRate: finiteNumber(source.videoBitRate, 'launch.videoBitRate', 0, 1000),
    videoBuffer: finiteNumber(source.videoBuffer, 'launch.videoBuffer', 0, 60_000),
    audioBuffer: finiteNumber(source.audioBuffer, 'launch.audioBuffer', 0, 60_000),
    maxSize: finiteNumber(source.maxSize, 'launch.maxSize', 0, 32_768),
    maxFps: finiteNumber(source.maxFps, 'launch.maxFps', 0, 1000),
    displayId: finiteNumber(source.displayId, 'launch.displayId', 0, 65_535),
    orientation: enumValue(source.orientation, 'launch.orientation', orientations),
    videoCodec: enumValue(source.videoCodec, 'launch.videoCodec', videoCodecs),
    videoEncoder: boundedString(source.videoEncoder, 'launch.videoEncoder', 512, true),
    audioCodec: enumValue(source.audioCodec, 'launch.audioCodec', audioCodecs),
    audioEncoder: boundedString(source.audioEncoder, 'launch.audioEncoder', 512, true),
    audioSource: enumValue(source.audioSource, 'launch.audioSource', audioSources),
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
    recordFormat: enumValue(source.recordFormat, 'launch.recordFormat', recordFormats),
    recordOrientation: enumValue(source.recordOrientation, 'launch.recordOrientation', recordOrientations),
    timeLimit: finiteNumber(source.timeLimit, 'launch.timeLimit', 0, 86_400),
    recordVideo: booleanField(source, 'recordVideo'),
    recordAudio: booleanField(source, 'recordAudio'),
    cameraId: boundedString(source.cameraId, 'launch.cameraId', 512, true),
    cameraFacing: enumValue(source.cameraFacing, 'launch.cameraFacing', cameraFacings),
    cameraSize: size(source.cameraSize, 'cameraSize'),
    cameraFps: finiteNumber(source.cameraFps, 'launch.cameraFps', 0, 1_000),
    cameraHighSpeed: booleanField(source, 'cameraHighSpeed'),
    cameraTorch: booleanField(source, 'cameraTorch'),
    cameraZoom: finiteNumber(source.cameraZoom, 'launch.cameraZoom', 1, 100),
    virtualDisplay: virtualDisplay(source.virtualDisplay),
    v4l2Sink: boundedString(source.v4l2Sink, 'launch.v4l2Sink', MAX_PATH_LENGTH, true),
    v4l2Buffer: finiteNumber(source.v4l2Buffer, 'launch.v4l2Buffer', 0, 60_000),
    v4l2Playback: booleanField(source, 'v4l2Playback'),
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
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_AUTOMATION_STEPS) {
    throw new TypeError(`automation steps must contain 1 to ${MAX_AUTOMATION_STEPS} actions.`)
  }
  let totalDuration = 0
  const steps = value.flatMap((item, index): AutomationStep[] => {
    const source = record(item, `steps[${index}]`)
    if (source.type === undefined && source.action !== undefined) {
      const delayMs = finiteNumber(source.delayMs, `steps[${index}].delayMs`, 0, 60_000)
      totalDuration += delayMs
      return [
        ...(delayMs ? [{ type: 'delay' as const, durationMs: delayMs }] : []),
        { type: 'control', action: controlAction(source.action) }
      ]
    }
    switch (source.type) {
      case 'delay': {
        const durationMs = finiteNumber(source.durationMs, `steps[${index}].durationMs`, 0, 60_000)
        totalDuration += durationMs
        return [{ type: 'delay', durationMs }]
      }
      case 'control':
        return [{ type: 'control', action: controlAction(source.action) }]
      case 'tap':
        return [{
          type: 'tap',
          x: finiteNumber(source.x, `steps[${index}].x`, 0, 1),
          y: finiteNumber(source.y, `steps[${index}].y`, 0, 1),
          coordinateSpace: enumValue(source.coordinateSpace, `steps[${index}].coordinateSpace`, new Set(['normalized' as const]))
        }]
      case 'swipe': {
        const from = record(source.from, `steps[${index}].from`)
        const to = record(source.to, `steps[${index}].to`)
        const durationMs = finiteNumber(source.durationMs, `steps[${index}].durationMs`, 1, 10_000)
        totalDuration += durationMs
        return [{
          type: 'swipe',
          from: { x: finiteNumber(from.x, `steps[${index}].from.x`, 0, 1), y: finiteNumber(from.y, `steps[${index}].from.y`, 0, 1) },
          to: { x: finiteNumber(to.x, `steps[${index}].to.x`, 0, 1), y: finiteNumber(to.y, `steps[${index}].to.y`, 0, 1) },
          durationMs,
          coordinateSpace: enumValue(source.coordinateSpace, `steps[${index}].coordinateSpace`, new Set(['normalized' as const]))
        }]
      }
      case 'text': {
        const text = boundedString(source.value, `steps[${index}].value`, 512)
        if (!SAFE_INPUT_TEXT.test(text)) throw new TypeError(`steps[${index}].value contains characters unsafe for Android input text.`)
        if (source.sensitive !== false) throw new TypeError('Sensitive text cannot be persisted in an automation.')
        return [{ type: 'text', value: text, sensitive: false }]
      }
      case 'start-app': {
        const packageId = boundedString(source.packageId, `steps[${index}].packageId`, 255)
        if (!PACKAGE_ID.test(packageId)) throw new TypeError(`steps[${index}].packageId is invalid.`)
        return [{ type: 'start-app', packageId }]
      }
      case 'screenshot':
        return [{
          type: 'screenshot',
          label: source.label === undefined ? undefined : boundedString(source.label, `steps[${index}].label`, 80, true)
        }]
      case 'assert-device': {
        const condition = record(source.condition, `steps[${index}].condition`)
        if (condition.type === 'orientation') {
          return [{
            type: 'assert-device',
            condition: { type: 'orientation', value: enumValue(condition.value, `steps[${index}].condition.value`, new Set(['portrait' as const, 'landscape' as const])) }
          }]
        }
        if (condition.type === 'aspect-ratio') {
          return [{
            type: 'assert-device',
            condition: {
              type: 'aspect-ratio',
              value: finiteNumber(condition.value, `steps[${index}].condition.value`, 0.1, 10),
              tolerance: finiteNumber(condition.tolerance, `steps[${index}].condition.tolerance`, 0, 1)
            }
          }]
        }
        throw new TypeError(`steps[${index}].condition.type is not supported.`)
      }
      default:
        throw new TypeError(`steps[${index}].type is not supported.`)
    }
  })
  if (steps.length > MAX_AUTOMATION_STEPS) throw new TypeError(`automation steps expand beyond ${MAX_AUTOMATION_STEPS} actions.`)
  if (totalDuration > MAX_AUTOMATION_DURATION_MS) throw new TypeError('automation duration may not exceed 30 minutes.')
  return steps
}

export function automationMacro(value: unknown, name = 'automation'): AutomationMacro {
  const source = record(value, name)
  const design = source.design === undefined ? {} : record(source.design, `${name}.design`)
  const orientation = design.orientation === undefined
    ? 'any'
    : enumValue(design.orientation, `${name}.design.orientation`, new Set(['any' as const, 'portrait' as const, 'landscape' as const]))
  return {
    id: boundedString(source.id, `${name}.id`, 128),
    name: boundedString(source.name, `${name}.name`, 128),
    description: source.description === undefined ? '' : boundedString(source.description, `${name}.description`, 1_024, true),
    schemaVersion: 2,
    design: {
      orientation,
      aspectRatio: design.aspectRatio === undefined ? 0 : finiteNumber(design.aspectRatio, `${name}.design.aspectRatio`, 0, 10)
    },
    steps: automationSteps(source.steps)
  }
}

export function batchPreflightRequest(value: unknown): BatchPreflightRequest {
  const source = record(value, 'batch preflight')
  const serials = deviceSerials(source.serials, 100)
  const concurrencyLimit = finiteNumber(source.concurrencyLimit, 'batch preflight concurrencyLimit', 1, 8)
  if (!Number.isInteger(concurrencyLimit)) throw new TypeError('batch preflight concurrencyLimit must be an integer.')
  const action = record(source.action, 'batch preflight action')
  switch (action.type) {
    case 'launch': {
      const launches = deviceLaunches(action.launches)
      const requested = new Set(serials)
      const launchSerials = new Set(launches.map((item) => item.serial))
      if (launches.length !== serials.length || launchSerials.size !== serials.length || launches.some((item) => !requested.has(item.serial))) {
        throw new TypeError('Batch launch plans must contain exactly one launch for every requested device.')
      }
      return { serials, concurrencyLimit, action: { type: 'launch', launches } }
    }
    case 'control':
      return { serials, concurrencyLimit, action: { type: 'control', action: controlAction(action.action) } }
    case 'screenshot':
      return { serials, concurrencyLimit, action: { type: 'screenshot' } }
    case 'start-app': {
      const packageId = boundedString(action.packageId, 'batch preflight packageId', 255)
      if (!PACKAGE_ID.test(packageId)) throw new TypeError('batch preflight packageId is invalid.')
      return { serials, concurrencyLimit, action: { type: 'start-app', packageId } }
    }
    case 'automation':
      return { serials, concurrencyLimit, action: { type: 'automation', automation: automationMacro(action.automation) } }
    case 'file-push': {
      const target = boundedString(action.target, 'batch preflight target', 1_024).trim()
      if (!target.startsWith('/') || /[\0\r\n\\]/.test(target) || target.split('/').some((part) => part === '.' || part === '..')) {
        throw new TypeError('batch preflight target must be a safe absolute Android directory.')
      }
      if (action.conflict !== 'replace' && action.conflict !== 'skip') throw new TypeError('batch preflight file conflict policy is not supported.')
      return { serials, concurrencyLimit, action: { type: 'file-push', target, conflict: action.conflict } }
    }
    case 'apk-install':
      return {
        serials,
        concurrencyLimit,
        action: {
          type: 'apk-install',
          replace: strictBoolean(action.replace, 'batch preflight replace existing app'),
          downgrade: strictBoolean(action.downgrade, 'batch preflight allow downgrade')
        }
      }
    default:
      throw new TypeError('Batch action type is not supported.')
  }
}

import type { LaunchConfig, SceneKind } from './types'
import { SCENE_MANAGED_FLAGS } from './scenes'

export type OptionCategory = 'general' | 'video' | 'controls' | 'recording' | 'geometry' | 'advanced'
export type OptionValueType = 'boolean' | 'number' | 'string' | 'enum' | 'path' | 'composite'

export interface OptionDescriptor {
  key: string
  flag: string
  aliases?: string[]
  category: OptionCategory
  valueType: OptionValueType
  defaultValue: unknown
  helpKey: string
  minScrcpyVersion: string
  scenes: SceneKind[]
  conflictsWith?: string[]
  requires?: string[]
  serialize(config: LaunchConfig): string[]
  validate(config: LaunchConfig): string | undefined
}

export interface SerializedOption {
  key: string
  flag: string
  category: OptionCategory
  helpKey: string
  args: string[]
}

export interface ExpertArgAnalysis {
  args: string[]
  warnings: string[]
}

const validPort = (value: string): boolean => /^\d{1,5}$/.test(value) && Number(value) >= 1 && Number(value) <= 65_535

export function validatePortRange(value: string): boolean {
  const ports = value.trim().split(':')
  if (ports.length < 1 || ports.length > 2 || ports.some((port) => !validPort(port))) return false
  return ports.length === 1 || Number(ports[0]) <= Number(ports[1])
}

function validPair(name: string, width: number, height: number): string | undefined {
  return (width > 0) === (height > 0) ? undefined : `${name} width and height must either both be zero or both be greater than zero.`
}

const ok = (): undefined => undefined
const screen: SceneKind[] = ['screen']
const visual: SceneKind[] = ['screen', 'camera', 'virtual-display', 'record-only']
const visualPlayback: SceneKind[] = ['screen', 'camera', 'virtual-display']
const windowed: SceneKind[] = ['screen', 'camera', 'virtual-display']
const input: SceneKind[] = ['screen', 'virtual-display', 'control-only', 'otg']
const adbScenes: SceneKind[] = ['screen', 'camera', 'virtual-display', 'record-only', 'control-only']
const screenVirtualRecord: SceneKind[] = ['screen', 'virtual-display', 'record-only']
const screenVirtual: SceneKind[] = ['screen', 'virtual-display']

export const OPTION_DESCRIPTORS: readonly OptionDescriptor[] = [
  { key: 'windowTitle', flag: '--window-title', category: 'general', valueType: 'string', defaultValue: '', helpKey: 'windowTitle', minScrcpyVersion: '4.0', scenes: windowed, serialize: (c) => c.windowTitle.trim() ? [`--window-title=${c.windowTitle.trim()}`] : [], validate: ok },
  { key: 'shortcutModifier', flag: '--shortcut-mod', category: 'controls', valueType: 'enum', defaultValue: 'default', helpKey: 'shortcutModifier', minScrcpyVersion: '4.0', scenes: input, serialize: (c) => c.shortcutModifier === 'default' ? [] : [`--shortcut-mod=${c.shortcutModifier}`], validate: ok },
  { key: 'keyboardMode', flag: '--keyboard', category: 'controls', valueType: 'enum', defaultValue: 'default', helpKey: 'keyboardMode', minScrcpyVersion: '4.0', scenes: input, serialize: (c) => c.keyboardMode === 'default' ? [] : [`--keyboard=${c.keyboardMode}`], validate: ok },
  { key: 'mouseMode', flag: '--mouse', category: 'controls', valueType: 'enum', defaultValue: 'default', helpKey: 'mouseMode', minScrcpyVersion: '4.0', scenes: input, serialize: (c) => c.mouseMode === 'default' ? [] : [`--mouse=${c.mouseMode}`], validate: ok },
  { key: 'gamepadMode', flag: '--gamepad', category: 'controls', valueType: 'enum', defaultValue: 'default', helpKey: 'gamepadMode', minScrcpyVersion: '4.0', scenes: input, serialize: (c) => c.gamepadMode === 'default' ? [] : [`--gamepad=${c.gamepadMode}`], validate: ok },
  { key: 'videoCodec', flag: '--video-codec', category: 'video', valueType: 'enum', defaultValue: 'default', helpKey: 'codec', minScrcpyVersion: '4.0', scenes: visual, serialize: (c) => c.scene === 'record-only' && !c.recordVideo || c.videoCodec === 'default' ? [] : [`--video-codec=${c.videoCodec}`], validate: ok },
  { key: 'videoBitRate', flag: '--video-bit-rate', aliases: ['-b'], category: 'video', valueType: 'number', defaultValue: 8, helpKey: 'bitRate', minScrcpyVersion: '4.0', scenes: visual, serialize: (c) => c.scene === 'record-only' && !c.recordVideo || c.videoBitRate <= 0 || c.videoBitRate === 8 ? [] : [`--video-bit-rate=${c.videoBitRate}M`], validate: ok },
  { key: 'videoBuffer', flag: '--video-buffer', category: 'video', valueType: 'number', defaultValue: 0, helpKey: 'videoBuffer', minScrcpyVersion: '4.0', scenes: windowed, serialize: (c) => c.videoBuffer > 0 ? [`--video-buffer=${Math.trunc(c.videoBuffer)}`] : [], validate: ok },
  { key: 'audioBuffer', flag: '--audio-buffer', category: 'video', valueType: 'number', defaultValue: 0, helpKey: 'audioBuffer', minScrcpyVersion: '4.0', scenes: visual, serialize: (c) => c.scene === 'record-only' && !c.recordAudio || c.audioBuffer <= 0 ? [] : [`--audio-buffer=${Math.trunc(c.audioBuffer)}`], validate: ok },
  { key: 'maxSize', flag: '--max-size', aliases: ['-m'], category: 'video', valueType: 'number', defaultValue: 0, helpKey: 'maxSize', minScrcpyVersion: '4.0', scenes: visual, serialize: (c) => c.scene === 'record-only' && !c.recordVideo || c.maxSize <= 0 ? [] : [`--max-size=${Math.trunc(c.maxSize)}`], validate: ok },
  { key: 'maxFps', flag: '--max-fps', category: 'video', valueType: 'number', defaultValue: 0, helpKey: 'maxFps', minScrcpyVersion: '4.0', scenes: screenVirtualRecord, serialize: (c) => c.scene === 'record-only' && !c.recordVideo || c.maxFps <= 0 ? [] : [`--max-fps=${Math.trunc(c.maxFps)}`], validate: ok },
  { key: 'displayId', flag: '--display-id', category: 'video', valueType: 'number', defaultValue: 0, helpKey: 'displayId', minScrcpyVersion: '4.0', scenes: screen, conflictsWith: ['newDisplay', 'camera'], serialize: (c) => c.displayId > 0 ? [`--display-id=${Math.trunc(c.displayId)}`] : [], validate: ok },
  { key: 'orientation', flag: '--orientation', category: 'video', valueType: 'enum', defaultValue: '0', helpKey: 'orientation', minScrcpyVersion: '4.0', scenes: visual, serialize: (c) => c.scene === 'record-only' && !c.recordVideo || c.orientation === '0' ? [] : [`--orientation=${c.orientation}`], validate: ok },
  { key: 'recording', flag: '--record', aliases: ['-r'], category: 'recording', valueType: 'path', defaultValue: false, helpKey: 'recordEnabled', minScrcpyVersion: '4.0', scenes: visual, requires: ['recordPath'], serialize: (c) => c.recordEnabled ? [`--record=${c.recordPath.trim()}`, ...(c.noPlayback && c.scene !== 'record-only' ? ['--no-playback', '--no-window'] : [])] : [], validate: (c) => c.recordEnabled && !c.recordPath.trim() ? 'Choose a recording file before starting scrcpy.' : undefined },
  { key: 'alwaysOnTop', flag: '--always-on-top', category: 'general', valueType: 'boolean', defaultValue: false, helpKey: 'alwaysOnTop', minScrcpyVersion: '4.0', scenes: windowed, serialize: (c) => c.alwaysOnTop ? ['--always-on-top'] : [], validate: ok },
  { key: 'control', flag: '--no-control', aliases: ['-n'], category: 'controls', valueType: 'boolean', defaultValue: true, helpKey: 'control', minScrcpyVersion: '4.0', scenes: screenVirtual, serialize: (c) => c.control ? [] : ['--no-control'], validate: ok },
  { key: 'audio', flag: '--no-audio', category: 'video', valueType: 'boolean', defaultValue: true, helpKey: 'audio', minScrcpyVersion: '4.0', scenes: visualPlayback, serialize: (c) => c.audio ? [] : ['--no-audio'], validate: ok },
  { key: 'turnScreenOff', flag: '--turn-screen-off', aliases: ['-S'], category: 'controls', valueType: 'boolean', defaultValue: false, helpKey: 'turnScreenOff', minScrcpyVersion: '4.0', scenes: screen, serialize: (c) => c.turnScreenOff ? ['--turn-screen-off'] : [], validate: ok },
  { key: 'stayAwake', flag: '--stay-awake', aliases: ['-w'], category: 'controls', valueType: 'boolean', defaultValue: false, helpKey: 'stayAwake', minScrcpyVersion: '4.0', scenes: screen, serialize: (c) => c.stayAwake ? ['--stay-awake'] : [], validate: ok },
  { key: 'showTouches', flag: '--show-touches', aliases: ['-t'], category: 'controls', valueType: 'boolean', defaultValue: false, helpKey: 'showTouches', minScrcpyVersion: '4.0', scenes: screen, serialize: (c) => c.showTouches ? ['--show-touches'] : [], validate: ok },
  { key: 'fullscreen', flag: '--fullscreen', aliases: ['-f'], category: 'general', valueType: 'boolean', defaultValue: false, helpKey: 'fullscreen', minScrcpyVersion: '4.0', scenes: windowed, serialize: (c) => c.fullscreen ? ['--fullscreen'] : [], validate: ok },
  { key: 'borderless', flag: '--window-borderless', category: 'general', valueType: 'boolean', defaultValue: false, helpKey: 'borderless', minScrcpyVersion: '4.0', scenes: windowed, serialize: (c) => c.borderless ? ['--window-borderless'] : [], validate: ok },
  { key: 'windowAspectRatioLock', flag: '--no-window-aspect-ratio-lock', category: 'geometry', valueType: 'boolean', defaultValue: true, helpKey: 'aspectRatioLock', minScrcpyVersion: '4.0', scenes: windowed, serialize: (c) => c.windowAspectRatioLock ? [] : ['--no-window-aspect-ratio-lock'], validate: ok },
  { key: 'pushTarget', flag: '--push-target', category: 'advanced', valueType: 'path', defaultValue: '', helpKey: 'pushTarget', minScrcpyVersion: '4.0', scenes: screenVirtual, serialize: (c) => c.pushTarget.trim() ? [`--push-target=${c.pushTarget.trim()}`] : [], validate: (c) => c.pushTarget.includes('\0') ? 'Push target may not contain null bytes.' : undefined },
  { key: 'tunnelPort', flag: '--port', category: 'advanced', valueType: 'string', defaultValue: '', helpKey: 'tunnelPort', minScrcpyVersion: '4.0', scenes: adbScenes, serialize: (c) => c.tunnelPort.trim() ? [`--port=${c.tunnelPort.trim()}`] : [], validate: (c) => c.tunnelPort.trim() && !validatePortRange(c.tunnelPort) ? 'Tunnel port must be a port or ascending port range from 1 to 65535.' : undefined },
  { key: 'crop', flag: '--crop', category: 'geometry', valueType: 'composite', defaultValue: { x: 0, y: 0, width: 0, height: 0 }, helpKey: 'crop', minScrcpyVersion: '4.0', scenes: screen, conflictsWith: ['camera'], serialize: (c) => c.crop.width > 0 ? [`--crop=${Math.trunc(c.crop.width)}:${Math.trunc(c.crop.height)}:${Math.trunc(c.crop.x)}:${Math.trunc(c.crop.y)}`] : [], validate: (c) => validPair('Crop', c.crop.width, c.crop.height) },
  { key: 'windowPosition', flag: '--window-x', category: 'geometry', valueType: 'composite', defaultValue: { x: 0, y: 0 }, helpKey: 'initialWindow', minScrcpyVersion: '4.0', scenes: windowed, serialize: (c) => [...(c.window.x !== 0 ? [`--window-x=${Math.trunc(c.window.x)}`] : []), ...(c.window.y !== 0 ? [`--window-y=${Math.trunc(c.window.y)}`] : [])], validate: ok },
  { key: 'windowSize', flag: '--window-width', category: 'geometry', valueType: 'composite', defaultValue: { width: 0, height: 0 }, helpKey: 'initialWindow', minScrcpyVersion: '4.0', scenes: windowed, serialize: (c) => c.window.width > 0 ? [`--window-width=${Math.trunc(c.window.width)}`, `--window-height=${Math.trunc(c.window.height)}`] : [], validate: (c) => validPair('Window', c.window.width, c.window.height) }
]

export function optionDefault<T>(key: string): T {
  const descriptor = OPTION_DESCRIPTORS.find((item) => item.key === key)
  if (!descriptor) throw new Error(`Unknown option descriptor: ${key}.`)
  return structuredClone(descriptor.defaultValue) as T
}

const managedFlags = new Map<string, string>()
for (const descriptor of OPTION_DESCRIPTORS) {
  managedFlags.set(descriptor.flag, descriptor.key)
  for (const alias of descriptor.aliases || []) managedFlags.set(alias, descriptor.key)
}
for (const [flag, key] of SCENE_MANAGED_FLAGS) managedFlags.set(flag, key)
managedFlags.set('--serial', 'serial')
managedFlags.set('-s', 'serial')
managedFlags.set('--no-playback', 'recording')
managedFlags.set('--no-window', 'recording')
managedFlags.set('--window-y', 'windowPosition')
managedFlags.set('--window-height', 'windowSize')

export function serializeLaunchOptions(config: LaunchConfig): SerializedOption[] {
  const descriptors = OPTION_DESCRIPTORS.filter((descriptor) => descriptor.scenes.includes(config.scene))
  const errors = descriptors.map((descriptor) => descriptor.validate(config)).filter(Boolean)
  if (errors.length) throw new Error(errors[0])
  return descriptors.map((descriptor) => ({
    key: descriptor.key,
    flag: descriptor.flag,
    category: descriptor.category,
    helpKey: descriptor.helpKey,
    args: descriptor.serialize(config)
  })).filter((entry) => entry.args.length > 0)
}

export function analyzeExpertArgs(value: string): ExpertArgAnalysis {
  const args = value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)
  const warnings: string[] = []
  for (const arg of args) {
    if (arg.includes('\0')) throw new Error('Additional arguments may not contain null bytes.')
    const flag = arg.match(/^(--[a-z0-9-]+|-[A-Za-z])(?:=|$)/)?.[1]
    if (flag && managedFlags.has(flag)) {
      throw new Error(`${flag} is managed by Scrcpy GUI (${managedFlags.get(flag)}) and cannot be overridden in expert arguments.`)
    }
    if (!flag) warnings.push(`Unrecognized expert argument syntax: ${arg}`)
    else warnings.push(`Expert argument ${flag} is not managed by this Scrcpy GUI version; it will be passed through unchanged.`)
  }
  return { args, warnings }
}

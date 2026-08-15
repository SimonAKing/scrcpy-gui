import type { LaunchConfig, SceneKind } from './types'

export type HostPlatform = 'darwin' | 'win32' | 'linux'

export interface SceneArgGroup {
  key: string
  flag: string
  category: 'general' | 'video' | 'controls' | 'recording' | 'geometry' | 'advanced'
  helpKey: string
  args: string[]
}

export const SCENE_KINDS: readonly SceneKind[] = [
  'screen', 'camera', 'virtual-display', 'record-only', 'control-only', 'otg'
]

export const SCENE_MANAGED_FLAGS: ReadonlyArray<readonly [string, string]> = [
  ['--video-source', 'scene'], ['--new-display', 'scene'], ['--no-video', 'scene'], ['--otg', 'scene'],
  ['--video-encoder', 'videoEncoder'], ['--audio-codec', 'audioCodec'], ['--audio-encoder', 'audioEncoder'],
  ['--audio-source', 'audioSource'], ['--time-limit', 'timeLimit'], ['--record-format', 'recordFormat'],
  ['--record-orientation', 'recordOrientation'], ['--camera-id', 'cameraId'], ['--camera-facing', 'cameraFacing'],
  ['--camera-size', 'cameraSize'], ['--camera-fps', 'cameraFps'], ['--camera-high-speed', 'cameraHighSpeed'],
  ['--camera-torch', 'cameraTorch'], ['--camera-zoom', 'cameraZoom'], ['--v4l2-sink', 'v4l2Sink'],
  ['--v4l2-buffer', 'v4l2Buffer'], ['--no-video-playback', 'v4l2Playback'],
  ['--no-vd-system-decorations', 'virtualDisplayDecorations'], ['--no-vd-destroy-content', 'virtualDisplayDestroy'],
  ['--flex-display', 'flexDisplay'], ['-x', 'flexDisplay'], ['--start-app', 'startApp'], ['--keep-active', 'keepActive'],
  ['--display-ime-policy', 'displayImePolicy']
]

const VISUAL_SCENES = new Set<SceneKind>(['screen', 'camera', 'virtual-display', 'record-only'])
const PACKAGE_ID = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/
const V4L2_DEVICE = /^\/dev\/video\d+$/
const ENCODER_NAME = /^[A-Za-z0-9._-]+$/
const CAMERA_ID = /^[A-Za-z0-9._:-]+$/

function group(
  key: string,
  flag: string,
  category: SceneArgGroup['category'],
  helpKey: string,
  args: string[]
): SceneArgGroup {
  return { key, flag, category, helpKey, args }
}

function validPair(width: number, height: number, label: string): void {
  if ((width > 0) !== (height > 0)) throw new Error(`${label} width and height must both be set or both be automatic.`)
}

export function isAdbScene(scene: SceneKind): boolean {
  return scene !== 'otg'
}

export function scenesConflict(left: SceneKind, right: SceneKind): boolean {
  return left === right || left === 'otg' || right === 'otg'
}

export function serializeSceneOptions(
  config: LaunchConfig,
  platform: HostPlatform
): SceneArgGroup[] {
  const result: SceneArgGroup[] = []
  const add = (entry: SceneArgGroup): void => {
    if (entry.args.length) result.push(entry)
  }

  if (!SCENE_KINDS.includes(config.scene)) throw new Error(`Unsupported launch scene: ${config.scene}.`)
  if (config.videoEncoder.trim() && !ENCODER_NAME.test(config.videoEncoder.trim())) throw new Error('Video encoder name is invalid.')
  if (config.audioEncoder.trim() && !ENCODER_NAME.test(config.audioEncoder.trim())) throw new Error('Audio encoder name is invalid.')

  if (VISUAL_SCENES.has(config.scene)) {
    const hasVideo = config.scene !== 'record-only' || config.recordVideo
    const hasAudio = config.scene !== 'record-only' || config.recordAudio
    add(group('videoEncoder', '--video-encoder', 'video', 'videoEncoder', hasVideo && config.videoEncoder.trim()
      ? [`--video-encoder=${config.videoEncoder.trim()}`] : []))
    add(group('audioCodec', '--audio-codec', 'video', 'audioCodec', !hasAudio || config.audioCodec === 'default'
      ? [] : [`--audio-codec=${config.audioCodec}`]))
    add(group('audioEncoder', '--audio-encoder', 'video', 'audioEncoder', hasAudio && config.audioEncoder.trim()
      ? [`--audio-encoder=${config.audioEncoder.trim()}`] : []))
    add(group('audioSource', '--audio-source', 'video', 'audioSource', !hasAudio || config.audioSource === 'default'
      ? [] : [`--audio-source=${config.audioSource}`]))
    add(group('timeLimit', '--time-limit', 'recording', 'timeLimit', config.timeLimit > 0
      ? [`--time-limit=${Math.trunc(config.timeLimit)}`] : []))
    add(group('recordFormat', '--record-format', 'recording', 'recordFormat', config.recordEnabled && config.recordFormat !== 'default'
      ? [`--record-format=${config.recordFormat}`] : []))
    add(group('recordOrientation', '--record-orientation', 'recording', 'recordOrientation', config.recordEnabled && config.recordOrientation !== 'default'
      ? [`--record-orientation=${config.recordOrientation}`] : []))
  }

  if (config.scene === 'camera') {
    if (config.cameraId.trim() && !CAMERA_ID.test(config.cameraId.trim())) throw new Error('Camera id is invalid.')
    if (config.cameraId.trim() && config.cameraFacing !== 'default') {
      throw new Error('Choose either an explicit camera id or a camera facing, not both.')
    }
    validPair(config.cameraSize.width, config.cameraSize.height, 'Camera size')
    if (config.cameraSize.width > 0 && config.maxSize > 0) {
      throw new Error('Explicit camera size conflicts with max size.')
    }
    if (config.cameraHighSpeed && (!config.cameraSize.width || !config.cameraFps)) {
      throw new Error('High-speed camera capture requires an explicit size and frame rate.')
    }
    if (config.v4l2Sink.trim()) {
      if (platform !== 'linux') throw new Error('V4L2 camera output is only available on Linux.')
      if (!V4L2_DEVICE.test(config.v4l2Sink.trim())) throw new Error('V4L2 sink must be a /dev/videoN device.')
    }
    add(group('scene', '--video-source', 'video', 'sceneCamera', ['--video-source=camera']))
    add(group('cameraId', '--camera-id', 'video', 'cameraId', config.cameraId.trim() ? [`--camera-id=${config.cameraId.trim()}`] : []))
    add(group('cameraFacing', '--camera-facing', 'video', 'cameraFacing', config.cameraFacing === 'default' ? [] : [`--camera-facing=${config.cameraFacing}`]))
    add(group('cameraSize', '--camera-size', 'video', 'cameraSize', config.cameraSize.width > 0
      ? [`--camera-size=${Math.trunc(config.cameraSize.width)}x${Math.trunc(config.cameraSize.height)}`] : []))
    add(group('cameraFps', '--camera-fps', 'video', 'cameraFps', config.cameraFps > 0 ? [`--camera-fps=${Math.trunc(config.cameraFps)}`] : []))
    add(group('cameraHighSpeed', '--camera-high-speed', 'video', 'cameraHighSpeed', config.cameraHighSpeed ? ['--camera-high-speed'] : []))
    add(group('cameraTorch', '--camera-torch', 'video', 'cameraTorch', config.cameraTorch ? ['--camera-torch'] : []))
    add(group('cameraZoom', '--camera-zoom', 'video', 'cameraZoom', config.cameraZoom !== 1 ? [`--camera-zoom=${config.cameraZoom}`] : []))
    add(group('v4l2Sink', '--v4l2-sink', 'video', 'v4l2Sink', config.v4l2Sink.trim() ? [`--v4l2-sink=${config.v4l2Sink.trim()}`] : []))
    add(group('v4l2Buffer', '--v4l2-buffer', 'video', 'v4l2Buffer', config.v4l2Sink.trim() && config.v4l2Buffer > 0
      ? [`--v4l2-buffer=${Math.trunc(config.v4l2Buffer)}`] : []))
    add(group('v4l2Playback', '--no-video-playback', 'video', 'v4l2Playback', config.v4l2Sink.trim() && !config.v4l2Playback
      ? ['--no-video-playback'] : []))
  }

  if (config.scene === 'virtual-display') {
    validPair(config.virtualDisplay.width, config.virtualDisplay.height, 'Virtual display size')
    if (!PACKAGE_ID.test(config.virtualDisplay.startApp.trim())) {
      throw new Error('Virtual display requires a valid Android package id to start.')
    }
    const size = config.virtualDisplay.width > 0
      ? `${Math.trunc(config.virtualDisplay.width)}x${Math.trunc(config.virtualDisplay.height)}`
      : ''
    const dpi = config.virtualDisplay.dpi > 0 ? `/${Math.trunc(config.virtualDisplay.dpi)}` : ''
    add(group('scene', '--new-display', 'video', 'sceneVirtualDisplay', [`--new-display${size || dpi ? `=${size}${dpi}` : ''}`]))
    add(group('virtualDisplayDecorations', '--no-vd-system-decorations', 'video', 'virtualDisplayDecorations', config.virtualDisplay.systemDecorations ? [] : ['--no-vd-system-decorations']))
    add(group('virtualDisplayDestroy', '--no-vd-destroy-content', 'video', 'virtualDisplayDestroy', config.virtualDisplay.destroyContent ? [] : ['--no-vd-destroy-content']))
    add(group('flexDisplay', '--flex-display', 'video', 'flexDisplay', config.virtualDisplay.flexDisplay ? ['--flex-display'] : []))
    add(group('startApp', '--start-app', 'general', 'startApp', [`--start-app=${config.virtualDisplay.startApp.trim()}`]))
    add(group('keepActive', '--keep-active', 'controls', 'keepActive', config.virtualDisplay.keepActive ? ['--keep-active'] : []))
    add(group('displayImePolicy', '--display-ime-policy', 'controls', 'displayImePolicy', config.virtualDisplay.imePolicy === 'local' ? ['--display-ime-policy=local'] : []))
  }

  if (config.scene === 'record-only') {
    if (!config.recordEnabled || !config.recordPath.trim()) throw new Error('Record-only scene requires a recording file.')
    if (!config.recordVideo && !config.recordAudio) throw new Error('Record-only scene must capture video, audio, or both.')
    add(group('scene', '--no-playback', 'recording', 'sceneRecordOnly', [
      '--no-playback', '--no-window',
      ...(!config.recordVideo ? ['--no-video'] : []),
      ...(!config.recordAudio ? ['--no-audio'] : [])
    ]))
  }

  if (config.scene === 'control-only') {
    add(group('scene', '--no-video', 'controls', 'sceneControlOnly', ['--no-video', '--no-audio']))
  }

  if (config.scene === 'otg') {
    if (config.keyboardMode === 'sdk' || config.keyboardMode === 'uhid' ||
        config.mouseMode === 'sdk' || config.mouseMode === 'uhid' || config.gamepadMode === 'uhid') {
      throw new Error('OTG input modes must use AOA, disabled, or their OTG defaults.')
    }
    add(group('scene', '--otg', 'controls', 'sceneOtg', ['--otg']))
  }

  return result
}

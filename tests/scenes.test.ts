import { describe, expect, it } from 'vitest'
import { defaultLaunchConfig } from '../src/shared/config'
import { scenesConflict, serializeSceneOptions } from '../src/shared/scenes'
import { buildScrcpyArgs } from '../src/main/scrcpy'

function args(config: ReturnType<typeof defaultLaunchConfig>, platform: 'darwin' | 'win32' | 'linux' = 'linux'): string[] {
  return serializeSceneOptions(config, platform).flatMap((entry) => entry.args)
}

describe('scene option serialization', () => {
  it('builds a camera source with explicit selection and capture controls', () => {
    const config = defaultLaunchConfig()
    config.scene = 'camera'
    config.cameraFacing = 'back'
    config.cameraSize = { width: 1920, height: 1080 }
    config.cameraFps = 60
    config.cameraTorch = true
    config.cameraZoom = 1.5
    config.audioSource = 'mic-camcorder'

    expect(buildScrcpyArgs(config, 'CAMERA-1')).toEqual(expect.arrayContaining([
      '--serial=CAMERA-1', '--video-source=camera', '--camera-facing=back', '--camera-size=1920x1080',
      '--camera-fps=60', '--camera-torch', '--camera-zoom=1.5', '--audio-source=mic-camcorder'
    ]))
  })

  it('rejects impossible camera combinations and gates V4L2 to Linux devices', () => {
    const selection = defaultLaunchConfig()
    selection.scene = 'camera'
    selection.cameraId = '0'
    selection.cameraFacing = 'front'
    expect(() => args(selection)).toThrow('either an explicit camera id')

    const size = defaultLaunchConfig()
    size.scene = 'camera'
    size.cameraSize = { width: 1920, height: 1080 }
    size.maxSize = 1280
    expect(() => args(size)).toThrow('conflicts with max size')

    const v4l2 = defaultLaunchConfig()
    v4l2.scene = 'camera'
    v4l2.v4l2Sink = '/dev/video2'
    v4l2.v4l2Playback = false
    expect(() => args(v4l2, 'darwin')).toThrow('only available on Linux')
    expect(args(v4l2, 'linux')).toEqual(expect.arrayContaining(['--v4l2-sink=/dev/video2', '--no-video-playback']))
  })

  it('builds a lifecycle-explicit virtual display and requires an app target', () => {
    const config = defaultLaunchConfig()
    config.scene = 'virtual-display'
    config.virtualDisplay = {
      width: 1920, height: 1080, dpi: 420, systemDecorations: false, destroyContent: false,
      flexDisplay: true, startApp: 'com.android.settings', keepActive: true, imePolicy: 'local'
    }
    expect(args(config)).toEqual([
      '--new-display=1920x1080/420', '--no-vd-system-decorations', '--no-vd-destroy-content',
      '--flex-display', '--start-app=com.android.settings', '--keep-active', '--display-ime-policy=local'
    ])

    config.virtualDisplay.startApp = ''
    expect(() => args(config)).toThrow('valid Android package id')

    config.virtualDisplay.startApp = 'com.android.settings'
    config.virtualDisplay.width = 0
    config.virtualDisplay.height = 0
    config.virtualDisplay.dpi = 240
    expect(args(config)[0]).toBe('--new-display=/240')
  })

  it('rejects control characters and unsafe identifiers without invoking a shell', () => {
    const camera = defaultLaunchConfig()
    camera.scene = 'camera'
    camera.cameraId = '0\n--otg'
    expect(() => args(camera)).toThrow('Camera id is invalid')

    camera.cameraId = '0'
    camera.videoEncoder = 'encoder\n--otg'
    expect(() => args(camera)).toThrow('Video encoder name is invalid')
  })

  it('builds record-only, control-only and OTG modes without shell commands', () => {
    const record = defaultLaunchConfig()
    record.scene = 'record-only'
    record.recordEnabled = true
    record.recordPath = '/tmp/capture.mkv'
    record.recordAudio = false
    record.recordFormat = 'mkv'
    expect(buildScrcpyArgs(record, 'REC-1')).toEqual(expect.arrayContaining([
      '--no-playback', '--no-window', '--no-audio', '--record-format=mkv', '--record=/tmp/capture.mkv'
    ]))

    const control = defaultLaunchConfig()
    control.scene = 'control-only'
    control.keyboardMode = 'uhid'
    expect(buildScrcpyArgs(control, 'CTRL-1')).toEqual(['--serial=CTRL-1', '--no-video', '--no-audio', '--keyboard=uhid'])
    control.mouseMode = 'sdk'
    expect(() => buildScrcpyArgs(control, 'CTRL-1')).toThrow('cannot use SDK mouse')

    const otg = defaultLaunchConfig()
    otg.scene = 'otg'
    otg.gamepadMode = 'aoa'
    expect(buildScrcpyArgs(otg, 'USB-1')).toEqual(['--serial=USB-1', '--otg', '--gamepad=aoa'])
    expect(buildScrcpyArgs(otg, '')).toEqual(['--otg', '--gamepad=aoa'])
    otg.keyboardMode = 'uhid'
    expect(() => buildScrcpyArgs(otg, 'USB-1')).toThrow('OTG input modes')
  })
})

describe('scene conflict matrix', () => {
  it('blocks duplicate scenes and OTG exclusivity while allowing independent sources', () => {
    expect(scenesConflict('screen', 'screen')).toBe(true)
    expect(scenesConflict('screen', 'camera')).toBe(false)
    expect(scenesConflict('camera', 'record-only')).toBe(false)
    expect(scenesConflict('otg', 'screen')).toBe(true)
    expect(scenesConflict('virtual-display', 'otg')).toBe(true)
  })

  it('allows an automatic USB selector only for OTG', () => {
    expect(() => buildScrcpyArgs(defaultLaunchConfig(), '')).toThrow('device serial is required')
  })
})

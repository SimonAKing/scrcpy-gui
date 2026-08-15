import { describe, expect, it } from 'vitest'
import type { LaunchConfig } from '../src/shared/types'
import {
  buildScrcpyArgs,
  isSupportedScrcpyVersion,
  parseAdbDevices,
  splitExtraArgs,
  validateDeviceAddress,
  validatePortRange
} from '../src/main/scrcpy'

function config(overrides: Partial<LaunchConfig> = {}): LaunchConfig {
  return {
    windowTitle: '',
    videoBitRate: 8,
    videoBuffer: 0,
    audioBuffer: 0,
    maxSize: 0,
    maxFps: 0,
    displayId: 0,
    orientation: '0',
    videoCodec: 'default',
    shortcutModifier: 'default',
    keyboardMode: 'default',
    mouseMode: 'default',
    gamepadMode: 'default',
    alwaysOnTop: false,
    control: true,
    audio: true,
    turnScreenOff: false,
    stayAwake: false,
    showTouches: false,
    fullscreen: false,
    borderless: false,
    windowAspectRatioLock: true,
    pushTarget: '',
    tunnelPort: '',
    recordEnabled: false,
    recordPath: '',
    autoRecordName: false,
    recordDirectory: '',
    noPlayback: false,
    crop: { x: 0, y: 0, width: 0, height: 0 },
    window: { x: 0, y: 0, width: 0, height: 0 },
    extraArgs: '',
    ...overrides
  }
}

describe('parseAdbDevices', () => {
  it('parses USB, wireless and unauthorized devices', () => {
    const devices = parseAdbDevices(`List of devices attached
R58M123\tdevice product:dreamlte model:Galaxy_S8 device:dreamlte transport_id:1
192.168.1.8:38891 device product:panther model:Pixel_7 device:panther transport_id:2
ABC123 unauthorized usb:1-2 transport_id:3
`)

    expect(devices).toHaveLength(3)
    expect(devices[0]).toMatchObject({ serial: 'R58M123', model: 'Galaxy S8', connection: 'usb' })
    expect(devices[1]).toMatchObject({ serial: '192.168.1.8:38891', model: 'Pixel 7', connection: 'wireless' })
    expect(devices[2]).toMatchObject({ serial: 'ABC123', state: 'unauthorized' })
  })
})

describe('isSupportedScrcpyVersion', () => {
  it('accepts current and future major versions', () => {
    expect(isSupportedScrcpyVersion('scrcpy 4.1 <https://github.com/Genymobile/scrcpy>')).toBe(true)
    expect(isSupportedScrcpyVersion('scrcpy 5.0')).toBe(true)
  })

  it('rejects legacy and unrelated executables', () => {
    expect(isSupportedScrcpyVersion('scrcpy 1.23')).toBe(false)
    expect(isSupportedScrcpyVersion('not scrcpy')).toBe(false)
  })
})

describe('validateDeviceAddress', () => {
  it.each([
    '192.168.0.3',
    '192.168.0.3:5555',
    'pixel.local:37123',
    '[2001:db8::1]:5555'
  ])('accepts %s', (value) => expect(validateDeviceAddress(value)).toBe(true))

  it.each(['256.1.1.1', 'host name:5555', 'phone:0', 'phone:65536', '2001:db8::1'])('rejects %s', (value) =>
    expect(validateDeviceAddress(value)).toBe(false)
  )

  it('requires a port for pairing', () => {
    expect(validateDeviceAddress('192.168.0.3', true)).toBe(false)
    expect(validateDeviceAddress('192.168.0.3:37123', true)).toBe(true)
  })
})

describe('buildScrcpyArgs', () => {
  it('uses current scrcpy 4.x flags without overriding normal Ctrl shortcuts', () => {
    const args = buildScrcpyArgs(
      config({
        videoBitRate: 12,
        maxSize: 1920,
        maxFps: 60,
        orientation: '90',
        keyboardMode: 'uhid',
        audio: false
      }),
      'ABC123'
    )

    expect(args).toEqual([
      '--serial=ABC123',
      '--keyboard=uhid',
      '--video-bit-rate=12M',
      '--max-size=1920',
      '--max-fps=60',
      '--orientation=90',
      '--no-audio'
    ])
    expect(args.some((arg) => arg.startsWith('--shortcut-mod'))).toBe(false)
  })

  it('builds recording, crop and window arguments', () => {
    const args = buildScrcpyArgs(
      config({
        recordEnabled: true,
        recordPath: '/tmp/demo.mp4',
        noPlayback: true,
        crop: { x: 10, y: 20, width: 1080, height: 1920 },
        window: { x: 40, y: 80, width: 540, height: 960 }
      }),
      'ABC123'
    )

    expect(args).toContain('--record=/tmp/demo.mp4')
    expect(args).toContain('--no-playback')
    expect(args).toContain('--no-window')
    expect(args).toContain('--crop=1080:1920:10:20')
    expect(args).toContain('--window-width=540')
    expect(args).toContain('--window-height=960')
  })

  it('rejects half-configured geometry instead of launching a broken command', () => {
    expect(() => buildScrcpyArgs(config({ crop: { x: 0, y: 0, width: 1080, height: 0 } }), 'ABC123')).toThrow(
      'Crop width and height'
    )
  })

  it('builds explicit input, file target and tunnel options', () => {
    const args = buildScrcpyArgs(
      config({ mouseMode: 'uhid', gamepadMode: 'aoa', pushTarget: '/sdcard/Movies/', tunnelPort: '28000:28010' }),
      'ABC123'
    )
    expect(args).toContain('--mouse=uhid')
    expect(args).toContain('--gamepad=aoa')
    expect(args).toContain('--push-target=/sdcard/Movies/')
    expect(args).toContain('--port=28000:28010')
  })
})

describe('validatePortRange', () => {
  it.each(['1', '5555', '27183:27199', '65535'])('accepts %s', (value) => expect(validatePortRange(value)).toBe(true))
  it.each(['0', '65536', '28000:27000', 'abc', '1:2:3'])('rejects %s', (value) => expect(validatePortRange(value)).toBe(false))
})

describe('splitExtraArgs', () => {
  it('passes one safe argument per line', () => {
    expect(splitExtraArgs(' --video-buffer=50 \n\n--power-off-on-close')).toEqual([
      '--video-buffer=50',
      '--power-off-on-close'
    ])
  })

  it('prevents callers from overriding the selected device', () => {
    expect(() => splitExtraArgs('--serial=other-device')).toThrow('cannot be overridden')
  })
})

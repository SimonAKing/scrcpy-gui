import { describe, expect, it } from 'vitest'
import type { LaunchConfig } from '../src/shared/types'
import { defaultLaunchConfig } from '../src/shared/config'
import { analyzeExpertArgs, OPTION_DESCRIPTORS, serializeLaunchOptions } from '../src/shared/options'
import { buildScrcpyArgDetails, prepareLaunchConfig } from '../src/main/scrcpy'

type OptionCase = [string, (config: LaunchConfig) => void, string[]]

const cases: OptionCase[] = [
  ['windowTitle', (c) => { c.windowTitle = 'Pixel' }, ['--window-title=Pixel']],
  ['shortcutModifier', (c) => { c.shortcutModifier = 'lalt' }, ['--shortcut-mod=lalt']],
  ['keyboardMode', (c) => { c.keyboardMode = 'uhid' }, ['--keyboard=uhid']],
  ['mouseMode', (c) => { c.mouseMode = 'aoa' }, ['--mouse=aoa']],
  ['gamepadMode', (c) => { c.gamepadMode = 'uhid' }, ['--gamepad=uhid']],
  ['videoCodec', (c) => { c.videoCodec = 'h265' }, ['--video-codec=h265']],
  ['videoBitRate', (c) => { c.videoBitRate = 12 }, ['--video-bit-rate=12M']],
  ['videoBuffer', (c) => { c.videoBuffer = 50 }, ['--video-buffer=50']],
  ['audioBuffer', (c) => { c.audioBuffer = 80 }, ['--audio-buffer=80']],
  ['maxSize', (c) => { c.maxSize = 1920 }, ['--max-size=1920']],
  ['maxFps', (c) => { c.maxFps = 60 }, ['--max-fps=60']],
  ['displayId', (c) => { c.displayId = 2 }, ['--display-id=2']],
  ['orientation', (c) => { c.orientation = '90' }, ['--orientation=90']],
  ['recording', (c) => { c.recordEnabled = true; c.recordPath = '/tmp/a.mp4'; c.noPlayback = true }, ['--record=/tmp/a.mp4', '--no-playback', '--no-window']],
  ['alwaysOnTop', (c) => { c.alwaysOnTop = true }, ['--always-on-top']],
  ['control', (c) => { c.control = false }, ['--no-control']],
  ['audio', (c) => { c.audio = false }, ['--no-audio']],
  ['turnScreenOff', (c) => { c.turnScreenOff = true }, ['--turn-screen-off']],
  ['stayAwake', (c) => { c.stayAwake = true }, ['--stay-awake']],
  ['showTouches', (c) => { c.showTouches = true }, ['--show-touches']],
  ['fullscreen', (c) => { c.fullscreen = true }, ['--fullscreen']],
  ['borderless', (c) => { c.borderless = true }, ['--window-borderless']],
  ['windowAspectRatioLock', (c) => { c.windowAspectRatioLock = false }, ['--no-window-aspect-ratio-lock']],
  ['pushTarget', (c) => { c.pushTarget = '/sdcard/Download/' }, ['--push-target=/sdcard/Download/']],
  ['tunnelPort', (c) => { c.tunnelPort = '27183:27199' }, ['--port=27183:27199']],
  ['crop', (c) => { c.crop = { x: 10, y: 20, width: 1080, height: 1920 } }, ['--crop=1080:1920:10:20']],
  ['windowPosition', (c) => { c.window.x = 40; c.window.y = 80 }, ['--window-x=40', '--window-y=80']],
  ['windowSize', (c) => { c.window.width = 540; c.window.height = 960 }, ['--window-width=540', '--window-height=960']]
]

describe('OptionDescriptor registry', () => {
  it('has unique keys and primary flags with complete compatibility metadata', () => {
    expect(new Set(OPTION_DESCRIPTORS.map((item) => item.key)).size).toBe(OPTION_DESCRIPTORS.length)
    expect(new Set(OPTION_DESCRIPTORS.map((item) => item.flag)).size).toBe(OPTION_DESCRIPTORS.length)
    for (const descriptor of OPTION_DESCRIPTORS) {
      expect(descriptor.helpKey).toBeTruthy()
      expect(descriptor.minScrcpyVersion).toBe('4.0')
      expect(descriptor.scenes).toContain('screen')
    }
  })

  it('serializes no managed flags from descriptor-owned defaults', () => {
    expect(serializeLaunchOptions(defaultLaunchConfig())).toEqual([])
  })

  it.each(cases)('serializes %s through its descriptor', (key, mutate, expected) => {
    const config = defaultLaunchConfig()
    mutate(config)
    const entry = serializeLaunchOptions(config).find((item) => item.key === key)
    expect(entry?.args).toEqual(expected)
  })

  it('validates composite and output-owning options before serialization', () => {
    const crop = defaultLaunchConfig()
    crop.crop.width = 1080
    expect(() => serializeLaunchOptions(crop)).toThrow('Crop width and height')
    const recording = defaultLaunchConfig()
    recording.recordEnabled = true
    expect(() => serializeLaunchOptions(recording)).toThrow('Choose a recording file')
    const port = defaultLaunchConfig()
    port.tunnelPort = '30000:20000'
    expect(() => serializeLaunchOptions(port)).toThrow('ascending port range')
  })
})

describe('expert argument policy', () => {
  it('preserves unknown flags in order and reports warnings', () => {
    const result = analyzeExpertArgs('--power-off-on-close\n--time-limit=30')
    expect(result.args).toEqual(['--power-off-on-close', '--time-limit=30'])
    expect(result.warnings).toHaveLength(2)
  })

  it.each(['--serial=other', '-s', '--video-buffer=50', '--record=a.mp4', '--window-height=900'])(
    'rejects managed duplicate %s',
    (arg) => expect(() => analyzeExpertArgs(arg)).toThrow('managed by Scrcpy GUI')
  )
})

describe('command provenance', () => {
  it('labels session, profile, device override and expert sources per argv token', () => {
    const config = defaultLaunchConfig()
    config.windowTitle = 'Lab phone'
    config.maxFps = 60
    config.extraArgs = '--power-off-on-close'
    const preview = buildScrcpyArgDetails(config, 'ABC', 'profile', 'Gaming', true)
    expect(preview.details).toMatchObject([
      { arg: '--serial=ABC', source: 'session' },
      { arg: '--window-title=Lab phone', source: 'device-override' },
      { arg: '--max-fps=60', source: 'profile', sourceLabel: 'Gaming' },
      { arg: '--power-off-on-close', source: 'expert' }
    ])
    expect(preview.warnings).toHaveLength(1)
  })

  it('creates deterministic automatic recording names and marks their argv generated', () => {
    const config = defaultLaunchConfig()
    config.recordEnabled = true
    config.autoRecordName = true
    config.recordDirectory = '/tmp/records'
    const prepared = prepareLaunchConfig(config, '192.168.1.2:5555', new Date('2026-08-15T12:34:56Z'))
    expect(prepared.recordPath).toContain('scrcpy-192.168.1.2-5555-2026-08-15T12-34-56.mp4')
    expect(buildScrcpyArgDetails(prepared, '192.168.1.2:5555').details.find((item) => item.optionKey === 'recording')?.source).toBe('generated')
  })
})

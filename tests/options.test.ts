import { describe, expect, it } from 'vitest'
import { basename, dirname, join } from 'node:path'
import type { LaunchConfig } from '../src/shared/types'
import { backgroundRecordingLaunch, defaultLaunchConfig, defaultPersistedConfig, launchForDevice } from '../src/shared/config'
import { analyzeExpertArgs, OPTION_DESCRIPTORS, serializeLaunchOptions } from '../src/shared/options'
import { buildScrcpyArgDetails, prepareLaunchConfig } from '../src/main/scrcpy'
import { SCENE_KINDS } from '../src/shared/scenes'

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
      expect(descriptor.scenes.length).toBeGreaterThan(0)
      expect(descriptor.scenes.every((scene) => SCENE_KINDS.includes(scene))).toBe(true)
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
    const result = analyzeExpertArgs('--power-off-on-close\n--render-expired-frames')
    expect(result.args).toEqual(['--power-off-on-close', '--render-expired-frames'])
    expect(result.warnings).toHaveLength(2)
  })

  it.each(['--serial=other', '-s', '--video-buffer=50', '--record=a.mp4', '--window-height=900', '--time-limit=30', '--camera-id=0'])(
    'rejects managed duplicate %s',
    (arg) => expect(() => analyzeExpertArgs(arg)).toThrow('managed by Scrcpy GUI')
  )
})

describe('command provenance', () => {
  it('keeps assigned file-based recording profiles launchable without a recording folder', () => {
    const config = defaultPersistedConfig('en')
    const launch = { ...defaultLaunchConfig(), scene: 'record-only' as const, recordEnabled: true,
      recordPath: '/recordings/profile.mkv', recordDirectory: '', recordFormat: 'mkv' as const }
    config.profiles = [{ id: 'record', name: 'Recording', launch }]
    config.deviceProfiles.PHONE = 'record'
    const selected = launchForDevice(config, 'PHONE')
    expect(selected).toEqual(launch)
    expect(buildScrcpyArgDetails(prepareLaunchConfig(selected, 'PHONE'), 'PHONE').args)
      .toContain('--record=/recordings/profile.mkv')
    config.launch = { ...launch, recordPath: '/recordings/current.wav', recordFormat: 'default',
      audioCodec: 'raw', recordVideo: false }
    const folderRecording = launchForDevice(config, 'PHONE')
    expect(folderRecording).toMatchObject({ autoRecordName: true, recordDirectory: '/recordings/', recordFormat: 'wav' })
    expect(prepareLaunchConfig(folderRecording, 'PHONE').recordPath).toMatch(/\.wav$/)
  })

  it('restores a legacy recording folder without changing WAV/raw recording settings', () => {
    const original = { ...defaultLaunchConfig(), scene: 'record-only' as const,
      recordEnabled: true, recordPath: '/recordings/audio.wav', recordDirectory: '',
      recordFormat: 'wav' as const, audioCodec: 'raw' as const, recordVideo: false }
    const launch = backgroundRecordingLaunch(original)
    const prepared = prepareLaunchConfig(launch, 'PHONE')
    expect(dirname(prepared.recordPath)).toBe(join('/recordings'))
    expect(basename(prepared.recordPath)).toMatch(/^scrcpy-PHONE-.*\.wav$/)
    expect(buildScrcpyArgDetails(prepared, 'PHONE').args).toEqual(expect.arrayContaining([
      '--record-format=wav', '--audio-codec=raw', '--no-video'
    ]))
    expect(original.autoRecordName).toBe(false)
    expect(original.recordDirectory).toBe('')
  })

  it('keeps an explicitly selected modifier instead of adding the macOS Command default', () => {
    const config = defaultLaunchConfig()
    config.shortcutModifier = 'lalt'
    expect(buildScrcpyArgDetails(config, 'ABC').args.filter((arg) => arg.startsWith('--shortcut-mod=')))
      .toEqual(['--shortcut-mod=lalt'])
  })

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
      ...(process.platform === 'darwin' ? [{ arg: '--shortcut-mod=lsuper', source: 'profile', sourceLabel: 'Gaming' }] : []),
      { arg: '--power-off-on-close', source: 'expert' }
    ])
    expect(preview.warnings).toHaveLength(1)
  })

  it('gives background recordings distinct MP4 paths even when started at the same time', () => {
    const config = { ...defaultLaunchConfig(), scene: 'record-only' as const,
      recordEnabled: true, autoRecordName: true, recordFormat: 'mp4' as const,
      recordDirectory: '/tmp/recordings with spaces' }
    const now = new Date('2026-10-27T03:00:00Z')
    const first = prepareLaunchConfig(config, 'device:5555', now)
    const second = prepareLaunchConfig(config, 'device:5555', now)
    expect(dirname(first.recordPath)).toBe(join('/tmp/recordings with spaces'))
    expect(basename(first.recordPath)).toMatch(/^scrcpy-device-5555-.*\.mp4$/)
    expect(second.recordPath).not.toBe(first.recordPath)
    expect(buildScrcpyArgDetails(first, 'device:5555').args).toEqual(expect.arrayContaining([
      `--record=${first.recordPath}`, '--record-format=mp4', '--no-playback', '--no-window'
    ]))
    expect(() => prepareLaunchConfig({ ...config, recordDirectory: '  ' }, 'device')).toThrow(/folder/)
  })

  it('creates deterministic automatic recording names and marks their argv generated', () => {
    const config = defaultLaunchConfig()
    config.recordEnabled = true
    config.autoRecordName = true
    config.recordDirectory = '/tmp/records'
    const prepared = prepareLaunchConfig(config, '192.168.1.2:5555', new Date('2026-08-15T12:34:56Z'))
    expect(prepared.recordPath).toContain('scrcpy-192.168.1.2-5555-2026-08-15T12-34-56.mp4')
    expect(buildScrcpyArgDetails(prepared, '192.168.1.2:5555').details.find((item) => item.optionKey === 'recording')?.source).toBe('generated')

    config.recordFormat = 'mkv'
    expect(prepareLaunchConfig(config, 'ABC', new Date('2026-08-15T12:34:56Z')).recordPath).toMatch(/\.mkv$/)
  })
})

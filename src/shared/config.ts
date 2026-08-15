import type { AppConfigV3, LaunchConfig, Locale, PersistedConfig } from './types'
import { optionDefault } from './options'

export function defaultLaunchConfig(): LaunchConfig {
  return {
    scene: 'screen', windowTitle: optionDefault('windowTitle'), videoBitRate: optionDefault('videoBitRate'),
    videoBuffer: optionDefault('videoBuffer'), audioBuffer: optionDefault('audioBuffer'), maxSize: optionDefault('maxSize'),
    maxFps: optionDefault('maxFps'), displayId: optionDefault('displayId'), orientation: optionDefault('orientation'),
    videoCodec: optionDefault('videoCodec'), videoEncoder: '', audioCodec: 'default', audioEncoder: '', audioSource: 'default',
    shortcutModifier: optionDefault('shortcutModifier'),
    keyboardMode: optionDefault('keyboardMode'), mouseMode: optionDefault('mouseMode'), gamepadMode: optionDefault('gamepadMode'),
    alwaysOnTop: optionDefault('alwaysOnTop'), control: optionDefault('control'), audio: optionDefault('audio'),
    turnScreenOff: optionDefault('turnScreenOff'), stayAwake: optionDefault('stayAwake'), showTouches: optionDefault('showTouches'),
    fullscreen: optionDefault('fullscreen'), borderless: optionDefault('borderless'),
    windowAspectRatioLock: optionDefault('windowAspectRatioLock'), pushTarget: optionDefault('pushTarget'),
    tunnelPort: optionDefault('tunnelPort'), recordEnabled: optionDefault('recording'), recordPath: '',
    autoRecordName: false, recordDirectory: '', noPlayback: false, recordFormat: 'default', recordOrientation: 'default',
    timeLimit: 0, recordVideo: true, recordAudio: true,
    cameraId: '', cameraFacing: 'default', cameraSize: { width: 0, height: 0 }, cameraFps: 0,
    cameraHighSpeed: false, cameraTorch: false, cameraZoom: 1,
    virtualDisplay: {
      width: 0, height: 0, dpi: 0, systemDecorations: true, destroyContent: true,
      flexDisplay: false, startApp: '', keepActive: false, imePolicy: 'default'
    },
    v4l2Sink: '', v4l2Buffer: 0, v4l2Playback: true, crop: optionDefault('crop'),
    window: { ...optionDefault<object>('windowPosition'), ...optionDefault<object>('windowSize') } as LaunchConfig['window'], extraArgs: ''
  }
}

export function normalizedLaunch(stored?: Partial<LaunchConfig>): LaunchConfig {
  const defaults = defaultLaunchConfig()
  return {
    ...defaults,
    ...stored,
    crop: { ...defaults.crop, ...stored?.crop },
    window: { ...defaults.window, ...stored?.window },
    cameraSize: { ...defaults.cameraSize, ...stored?.cameraSize },
    virtualDisplay: { ...defaults.virtualDisplay, ...stored?.virtualDisplay }
  }
}

export function defaultPersistedConfig(locale: Locale): PersistedConfig {
  return {
    runtime: { scrcpyPath: '' }, locale, muteNotifications: false, minimizeToTray: false, killAdbOnQuit: false,
    bossKeyEnabled: false, bossKeyAccelerator: 'CommandOrControl+Shift+B', autoSelectFirstDevice: true,
    autoLaunchDevices: {}, launch: defaultLaunchConfig(), profiles: [], deviceProfiles: {}, deviceAliases: {},
    wirelessTargets: [], automations: [], groups: []
  }
}

export function legacyConfigView(value: unknown, locale: Locale): PersistedConfig {
  const defaults = defaultPersistedConfig(locale)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults
  const stored = value as Partial<PersistedConfig>
  const profiles = Array.isArray(stored.profiles)
    ? stored.profiles.map((profile) => {
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return profile as never
      return { ...profile, launch: normalizedLaunch(profile.launch) }
    })
    : []
  return {
    ...defaults,
    ...stored,
    runtime: { ...defaults.runtime, ...stored.runtime },
    launch: normalizedLaunch(stored.launch),
    profiles,
    deviceProfiles: stored.deviceProfiles || {}, deviceAliases: stored.deviceAliases || {},
    autoLaunchDevices: stored.autoLaunchDevices || {},
    wirelessTargets: Array.isArray(stored.wirelessTargets) ? stored.wirelessTargets : [],
    automations: Array.isArray(stored.automations) ? stored.automations : [],
    groups: Array.isArray(stored.groups) ? stored.groups : []
  }
}

export function configView(config: AppConfigV3): PersistedConfig {
  const deviceProfiles: Record<string, string> = {}
  const deviceAliases: Record<string, string> = {}
  const autoLaunchDevices: Record<string, boolean> = {}
  for (const device of config.knownDevices) {
    if (device.defaultProfileId) deviceProfiles[device.lastSerial] = device.defaultProfileId
    if (device.alias) deviceAliases[device.lastSerial] = device.alias
    if (device.autoLaunch) autoLaunchDevices[device.lastSerial] = true
  }
  const serialByDeviceId = new Map(config.knownDevices.map((device) => [device.id, device.lastSerial]))
  return {
    runtime: { scrcpyPath: config.runtime.mode === 'custom' ? config.runtime.customScrcpyPath : '' },
    launch: structuredClone(config.defaults.launch), profiles: structuredClone(config.profiles), deviceProfiles,
    deviceAliases, wirelessTargets: structuredClone(config.wirelessTargets), automations: structuredClone(config.automations),
    groups: config.groups.map((group) => ({
      id: group.id,
      name: group.name,
      serials: group.deviceIds.map((id) => serialByDeviceId.get(id)).filter(Boolean) as string[],
      defaultProfileId: group.defaultProfileId,
      concurrencyLimit: group.concurrencyLimit,
      description: group.description
    })),
    locale: config.locale, muteNotifications: config.appearance.muteNotifications,
    minimizeToTray: config.defaults.minimizeToTray, killAdbOnQuit: config.defaults.killAdbOnQuit,
    bossKeyEnabled: config.shortcuts.bossKeyEnabled, bossKeyAccelerator: config.shortcuts.bossKeyAccelerator,
    autoSelectFirstDevice: config.defaults.autoSelectFirstDevice, autoLaunchDevices
  }
}

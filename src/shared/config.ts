import type { AppConfigV3, LaunchConfig, Locale, PersistedConfig } from './types'

export function defaultLaunchConfig(): LaunchConfig {
  return {
    windowTitle: '', videoBitRate: 8, videoBuffer: 0, audioBuffer: 0, maxSize: 0, maxFps: 0, displayId: 0,
    orientation: '0', videoCodec: 'default',
    shortcutModifier: 'default', keyboardMode: 'default', mouseMode: 'default', gamepadMode: 'default',
    alwaysOnTop: false, control: true, audio: true,
    turnScreenOff: false, stayAwake: false, showTouches: false, fullscreen: false, borderless: false,
    windowAspectRatioLock: true, pushTarget: '', tunnelPort: '',
    recordEnabled: false, recordPath: '', autoRecordName: false, recordDirectory: '', noPlayback: false,
    crop: { x: 0, y: 0, width: 0, height: 0 }, window: { x: 0, y: 0, width: 0, height: 0 }, extraArgs: ''
  }
}

export function normalizedLaunch(stored?: Partial<LaunchConfig>): LaunchConfig {
  const defaults = defaultLaunchConfig()
  return {
    ...defaults,
    ...stored,
    crop: { ...defaults.crop, ...stored?.crop },
    window: { ...defaults.window, ...stored?.window }
  }
}

export function defaultPersistedConfig(locale: Locale): PersistedConfig {
  return {
    runtime: { scrcpyPath: '' }, locale, muteNotifications: false, minimizeToTray: false, killAdbOnQuit: false,
    bossKeyEnabled: false, bossKeyAccelerator: 'CommandOrControl+Shift+B', autoSelectFirstDevice: true,
    autoLaunchDevices: {}, launch: defaultLaunchConfig(), profiles: [], deviceProfiles: {}, deviceAliases: {},
    wirelessTargets: [], automations: []
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
    automations: Array.isArray(stored.automations) ? stored.automations : []
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
  return {
    runtime: { scrcpyPath: config.runtime.mode === 'custom' ? config.runtime.customScrcpyPath : '' },
    launch: structuredClone(config.defaults.launch), profiles: structuredClone(config.profiles), deviceProfiles,
    deviceAliases, wirelessTargets: structuredClone(config.wirelessTargets), automations: structuredClone(config.automations),
    locale: config.locale, muteNotifications: config.appearance.muteNotifications,
    minimizeToTray: config.defaults.minimizeToTray, killAdbOnQuit: config.defaults.killAdbOnQuit,
    bossKeyEnabled: config.shortcuts.bossKeyEnabled, bossKeyAccelerator: config.shortcuts.bossKeyAccelerator,
    autoSelectFirstDevice: config.defaults.autoSelectFirstDevice, autoLaunchDevices
  }
}

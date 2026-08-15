export type DeviceState = 'device' | 'offline' | 'unauthorized' | 'recovery' | 'unknown'

export interface Device {
  serial: string
  state: DeviceState
  model: string
  product: string
  device: string
  transportId?: string
  connection: 'usb' | 'wireless'
}

export interface DeviceTrackerEvent {
  status: 'starting' | 'tracking' | 'restarting' | 'error' | 'stopped'
  source: 'track' | 'poll'
  devices: Device[]
  added: Device[]
  changed: Device[]
  removed: Device[]
  revision: number
  timestamp: string
  message: string
  retryInMs?: number
}

export interface RuntimeConfig {
  scrcpyPath: string
}

export type Orientation = '0' | '90' | '180' | '270'
export type ShortcutModifier = 'default' | 'lctrl' | 'rctrl' | 'lalt' | 'ralt' | 'lsuper' | 'rsuper'
export type KeyboardMode = 'default' | 'sdk' | 'uhid' | 'aoa'
export type MouseMode = 'default' | 'sdk' | 'uhid' | 'aoa' | 'disabled'
export type GamepadMode = 'default' | 'uhid' | 'aoa'
export type VideoCodec = 'default' | 'h264' | 'h265' | 'av1' | 'vp8' | 'vp9'

export interface LaunchConfig {
  windowTitle: string
  videoBitRate: number
  videoBuffer: number
  audioBuffer: number
  maxSize: number
  maxFps: number
  displayId: number
  orientation: Orientation
  videoCodec: VideoCodec
  shortcutModifier: ShortcutModifier
  keyboardMode: KeyboardMode
  mouseMode: MouseMode
  gamepadMode: GamepadMode
  alwaysOnTop: boolean
  control: boolean
  audio: boolean
  turnScreenOff: boolean
  stayAwake: boolean
  showTouches: boolean
  fullscreen: boolean
  borderless: boolean
  windowAspectRatioLock: boolean
  pushTarget: string
  tunnelPort: string
  recordEnabled: boolean
  recordPath: string
  autoRecordName: boolean
  recordDirectory: string
  noPlayback: boolean
  crop: {
    x: number
    y: number
    width: number
    height: number
  }
  window: {
    x: number
    y: number
    width: number
    height: number
  }
  extraArgs: string
}

export interface LaunchProfile {
  id: string
  name: string
  launch: LaunchConfig
}

export interface DeviceLaunch {
  serial: string
  launch: LaunchConfig
}

export interface CommandPreview {
  serial: string
  args: string[]
}

export type SceneKind = 'screen'
export type SessionState = 'queued' | 'preflighting' | 'launching' | 'running' | 'stopping' | 'stopped' | 'failed'
export type SessionStopReason = 'user' | 'boss-key' | 'app-quit' | 'process-exit' | 'launch-error'

export interface ScrcpySession {
  id: string
  serialAtLaunch: string
  scene: SceneKind
  state: SessionState
  args: string[]
  createdAt: string
  startedAt?: string
  endedAt?: string
  pid?: number
  exitCode?: number
  stopReason?: SessionStopReason
  error?: string
}

export interface ScrcpySessionEvent {
  type: 'state' | 'output'
  session: ScrcpySession
  message: string
  timestamp: string
}

export interface WirelessTarget {
  id: string
  name: string
  address: string
  autoConnect: boolean
}

export type DeviceControlAction =
  | 'back'
  | 'home'
  | 'app-switch'
  | 'menu'
  | 'volume-up'
  | 'volume-down'
  | 'power'
  | 'screen-on'
  | 'screen-off'
  | 'rotate'
  | 'auto-rotate'
  | 'show-touches-on'
  | 'show-touches-off'

export interface AutomationStep {
  action: DeviceControlAction
  delayMs: number
}

export interface AutomationMacro {
  id: string
  name: string
  steps: AutomationStep[]
}

export type Locale = 'en' | 'zh-CN' | 'zh-TW' | 'ru'

export interface PersistedConfig {
  runtime: RuntimeConfig
  launch: LaunchConfig
  profiles: LaunchProfile[]
  deviceProfiles: Record<string, string>
  deviceAliases: Record<string, string>
  wirelessTargets: WirelessTarget[]
  automations: AutomationMacro[]
  locale: Locale
  muteNotifications: boolean
  minimizeToTray: boolean
  killAdbOnQuit: boolean
  bossKeyEnabled: boolean
  bossKeyAccelerator: string
  autoSelectFirstDevice: boolean
  autoLaunchDevices: Record<string, boolean>
}

export interface KnownDevice {
  id: string
  lastSerial: string
  alias: string
  model: string
  lastConnection: 'usb' | 'wireless'
  defaultProfileId?: string
  groupIds: string[]
  autoConnect: boolean
  autoLaunch: boolean
  firstSeenAt: string
  lastSeenAt: string
}

export interface DeviceGroup {
  id: string
  name: string
  deviceIds: string[]
}

export interface AppConfigV3 {
  schemaVersion: 3
  revision: number
  locale: Locale
  appearance: {
    muteNotifications: boolean
  }
  runtime: {
    mode: 'bundled' | 'custom'
    customScrcpyPath: string
  }
  defaults: {
    launch: LaunchConfig
    minimizeToTray: boolean
    killAdbOnQuit: boolean
    autoSelectFirstDevice: boolean
  }
  shortcuts: {
    bossKeyEnabled: boolean
    bossKeyAccelerator: string
  }
  knownDevices: KnownDevice[]
  profiles: LaunchProfile[]
  wirelessTargets: WirelessTarget[]
  automations: AutomationMacro[]
  groups: DeviceGroup[]
}

export interface ConfigMigrationReport {
  source: 'existing-v3' | 'legacy-v2' | 'defaults' | 'backup'
  imported: number
  skipped: number
  invalid: number
}

export interface ConfigLoadResult {
  config: PersistedConfig
  revision: number
  migration: ConfigMigrationReport
}

export interface ConfigSaveResult {
  config: PersistedConfig
  revision: number
}

export interface EnvironmentStatus {
  scrcpy: {
    ok: boolean
    path: string
    version: string
    error: string
    capabilities?: CapabilitySnapshot
    capabilityError?: string
  }
  adb: {
    ok: boolean
    path: string
    version: string
    error: string
  }
}

export interface CapabilitySnapshot {
  flags: string[]
  features: {
    screen: boolean
    camera: boolean
    virtualDisplay: boolean
    recordOnly: boolean
    controlOnly: boolean
    otg: boolean
    v4l2: boolean
    appLaunch: boolean
  }
  probes: {
    encoders: boolean
    displays: boolean
    cameras: boolean
    cameraSizes: boolean
    apps: boolean
  }
}

export interface OperationResult<T = undefined> {
  ok: boolean
  data?: T
  error?: string
}

export interface ScrcpyStatusEvent {
  serial: string
  status: 'starting' | 'running' | 'stopped' | 'error' | 'log'
  message: string
  timestamp: string
}

export interface ScrcpyApi {
  getVersion(): Promise<string>
  chooseScrcpy(): Promise<string>
  chooseRecordPath(): Promise<string>
  chooseRecordDirectory(): Promise<string>
  loadConfig(legacyJson: string, locale: Locale): Promise<ConfigLoadResult>
  saveConfig(revision: number, config: PersistedConfig): Promise<OperationResult<ConfigSaveResult>>
  getEnvironment(runtime: RuntimeConfig): Promise<EnvironmentStatus>
  listDevices(runtime: RuntimeConfig): Promise<OperationResult<Device[]>>
  trackDevices(runtime: RuntimeConfig): Promise<OperationResult<Device[]>>
  setDeviceTrackerVisibility(visible: boolean): Promise<void>
  connect(runtime: RuntimeConfig, target: string): Promise<OperationResult<string>>
  pair(runtime: RuntimeConfig, target: string, code: string): Promise<OperationResult<string>>
  disconnect(runtime: RuntimeConfig, target: string): Promise<OperationResult<string>>
  start(runtime: RuntimeConfig, launches: DeviceLaunch[]): Promise<OperationResult<string[]>>
  preview(launches: DeviceLaunch[]): Promise<OperationResult<CommandPreview[]>>
  listSessions(): Promise<ScrcpySession[]>
  stopSession(id: string): Promise<OperationResult>
  stop(serial: string): Promise<OperationResult>
  control(runtime: RuntimeConfig, serial: string, action: DeviceControlAction): Promise<OperationResult<string>>
  screenshot(runtime: RuntimeConfig, serial: string): Promise<OperationResult<string>>
  runAutomation(runtime: RuntimeConfig, serial: string, steps: AutomationStep[]): Promise<OperationResult<string>>
  setMinimizeToTray(enabled: boolean): Promise<void>
  setQuitBehavior(runtime: RuntimeConfig, killAdbOnQuit: boolean): Promise<void>
  setBossKey(enabled: boolean, accelerator: string): Promise<OperationResult<string>>
  openExternal(url: string): Promise<void>
  onStatus(callback: (event: ScrcpyStatusEvent) => void): () => void
  onSession(callback: (event: ScrcpySessionEvent) => void): () => void
  onDevices(callback: (event: DeviceTrackerEvent) => void): () => void
}

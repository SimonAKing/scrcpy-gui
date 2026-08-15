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

export interface RuntimeConfig {
  scrcpyPath: string
}

export type Orientation = '0' | '90' | '180' | '270'
export type ShortcutModifier = 'default' | 'lctrl' | 'rctrl' | 'lalt' | 'ralt' | 'lsuper' | 'rsuper'
export type KeyboardMode = 'default' | 'sdk' | 'uhid' | 'aoa'
export type VideoCodec = 'default' | 'h264' | 'h265' | 'av1' | 'vp8' | 'vp9'

export interface LaunchConfig {
  windowTitle: string
  videoBitRate: number
  maxSize: number
  maxFps: number
  orientation: Orientation
  videoCodec: VideoCodec
  shortcutModifier: ShortcutModifier
  keyboardMode: KeyboardMode
  alwaysOnTop: boolean
  control: boolean
  audio: boolean
  turnScreenOff: boolean
  stayAwake: boolean
  showTouches: boolean
  fullscreen: boolean
  borderless: boolean
  recordEnabled: boolean
  recordPath: string
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

export interface PersistedConfig {
  runtime: RuntimeConfig
  launch: LaunchConfig
  locale: 'en' | 'zh-CN' | 'zh-TW' | 'ru'
  muteNotifications: boolean
  minimizeToTray: boolean
}

export interface EnvironmentStatus {
  scrcpy: {
    ok: boolean
    path: string
    version: string
    error: string
  }
  adb: {
    ok: boolean
    path: string
    version: string
    error: string
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
  getEnvironment(runtime: RuntimeConfig): Promise<EnvironmentStatus>
  listDevices(runtime: RuntimeConfig): Promise<OperationResult<Device[]>>
  connect(runtime: RuntimeConfig, target: string): Promise<OperationResult<string>>
  pair(runtime: RuntimeConfig, target: string, code: string): Promise<OperationResult<string>>
  disconnect(runtime: RuntimeConfig, target: string): Promise<OperationResult<string>>
  start(runtime: RuntimeConfig, launch: LaunchConfig, serials: string[]): Promise<OperationResult<string[]>>
  stop(serial: string): Promise<OperationResult>
  setMinimizeToTray(enabled: boolean): Promise<void>
  openExternal(url: string): Promise<void>
  onStatus(callback: (event: ScrcpyStatusEvent) => void): () => void
}

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

export type AppEventLevel = 'debug' | 'info' | 'warn' | 'error'
export type AppEventDomain = 'runtime' | 'device' | 'session' | 'config' | 'automation' | 'artifact' | 'update'

export interface AppEvent {
  id: string
  timestamp: string
  level: AppEventLevel
  domain: AppEventDomain
  action: string
  requestId?: string
  deviceId?: string
  sessionId?: string
  stage?: string
  message: string
  data?: Record<string, unknown>
}

export interface AppEventQuery {
  limit: number
  levels?: AppEventLevel[]
  domains?: AppEventDomain[]
}

export interface RuntimeConfig {
  scrcpyPath: string
}

export type SceneKind = 'screen' | 'camera' | 'virtual-display' | 'record-only' | 'control-only' | 'otg'
export type Orientation = '0' | '90' | '180' | '270'
export type RecordOrientation = 'default' | Orientation
export type ShortcutModifier = 'default' | 'lctrl' | 'rctrl' | 'lalt' | 'ralt' | 'lsuper' | 'rsuper'
export type KeyboardMode = 'default' | 'sdk' | 'uhid' | 'aoa' | 'disabled'
export type MouseMode = 'default' | 'sdk' | 'uhid' | 'aoa' | 'disabled'
export type GamepadMode = 'default' | 'uhid' | 'aoa'
export type VideoCodec = 'default' | 'h264' | 'h265' | 'av1' | 'vp8' | 'vp9'
export type AudioCodec = 'default' | 'opus' | 'aac' | 'flac' | 'raw'
export type AudioSource =
  | 'default'
  | 'output'
  | 'playback'
  | 'mic'
  | 'mic-unprocessed'
  | 'mic-camcorder'
  | 'mic-voice-recognition'
  | 'mic-voice-communication'
  | 'voice-call'
  | 'voice-call-uplink'
  | 'voice-call-downlink'
  | 'voice-performance'
export type CameraFacing = 'default' | 'front' | 'back' | 'external'
export type RecordFormat = 'default' | 'mp4' | 'mkv' | 'm4a' | 'mka' | 'opus' | 'aac' | 'flac' | 'wav'
export type DisplayImePolicy = 'default' | 'local'

export interface LaunchConfig {
  scene: SceneKind
  windowTitle: string
  videoBitRate: number
  videoBuffer: number
  audioBuffer: number
  maxSize: number
  maxFps: number
  displayId: number
  orientation: Orientation
  videoCodec: VideoCodec
  videoEncoder: string
  audioCodec: AudioCodec
  audioEncoder: string
  audioSource: AudioSource
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
  recordFormat: RecordFormat
  recordOrientation: RecordOrientation
  timeLimit: number
  recordVideo: boolean
  recordAudio: boolean
  cameraId: string
  cameraFacing: CameraFacing
  cameraSize: {
    width: number
    height: number
  }
  cameraFps: number
  cameraHighSpeed: boolean
  cameraTorch: boolean
  cameraZoom: number
  virtualDisplay: {
    width: number
    height: number
    dpi: number
    systemDecorations: boolean
    destroyContent: boolean
    flexDisplay: boolean
    startApp: string
    keepActive: boolean
    imePolicy: DisplayImePolicy
  }
  v4l2Sink: string
  v4l2Buffer: number
  v4l2Playback: boolean
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

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export interface LaunchProfile {
  id: string
  name: string
  launch: LaunchConfig
  extensions?: Record<string, JsonValue>
}

export interface ProfileImportPreview {
  token: string
  name: string
  scene: SceneKind
  appVersion: string
  minScrcpyVersion: string
  compatible: boolean
  warnings: string[]
  unknownFields: string[]
  machineLocalPaths: Array<{ field: 'recordPath' | 'recordDirectory' | 'v4l2Sink'; value: string }>
  conflict?: { profileId: string; name: string }
}

export type ProfileImportStrategy = 'keep' | 'replace' | 'duplicate'

export type ProfileImportCommit =
  | { profile: LaunchProfile; replacedProfileId?: string; keptExisting?: false }
  | { keptExisting: true; replacedProfileId: string; profile?: never }

export interface DeviceLaunch {
  serial: string
  launch: LaunchConfig
}

export interface CommandPreviewRequest extends DeviceLaunch {
  source: 'global' | 'profile'
  profileName?: string
  deviceWindowTitleOverride: boolean
}

export type CommandArgSource = 'session' | 'scene-default' | 'global' | 'profile' | 'device-override' | 'generated' | 'expert'

export interface CommandArgDetail {
  arg: string
  optionKey: string
  helpKey: string
  source: CommandArgSource
  sourceLabel?: string
}

export interface CommandPreview {
  serial: string
  args: string[]
  details: CommandArgDetail[]
  warnings: string[]
}

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

export type FileConflictPolicy = 'replace' | 'skip'

export interface BatchItemResult<T> {
  targetId: string
  ok: boolean
  data?: T
  error?: StructuredError
}

export interface BatchOperationResult<T> {
  id: string
  startedAt: string
  completedAt: string
  results: BatchItemResult<T>[]
}

export interface BatchProgressEvent {
  batchId: string
  kind: 'file-push' | 'apk-install' | 'launch' | 'control' | 'screenshot' | 'start-app' | 'automation'
  deviceId: string
  targetId: string
  status: 'running' | 'success' | 'failed' | 'skipped'
  timestamp: string
  message: string
  size?: number
}

export interface FileTransferResult {
  serial: string
  sourceName: string
  size: number
  targetPath: string
  skipped: boolean
  output: string
}

export interface ApkInstallResult {
  serial: string
  sourceName: string
  size: number
  replace: boolean
  downgrade: boolean
  output: string
}

export interface InstalledApp {
  packageId: string
  label: string
  system: boolean
  launchable: boolean
}

export interface DeviceOverview {
  serial: string
  manufacturer: string
  model: string
  androidVersion: string
  sdk: string
  abi: string
  displaySize: string
  batteryLevel?: number
}

export type ArtifactKind = 'screenshot' | 'recording' | 'transfer-report' | 'diagnostic'
export type ArtifactStatus = 'available' | 'missing' | 'incomplete'

export interface ArtifactRecord {
  id: string
  kind: ArtifactKind
  status: ArtifactStatus
  createdAt: string
  updatedAt: string
  name: string
  path: string
  size: number
  deviceId?: string
  sessionId?: string
  metadata: Record<string, string | number | boolean>
}

export interface ArtifactQuery {
  limit: number
  kinds?: ArtifactKind[]
  deviceId?: string
}

export interface DiagnosticPreview {
  files: Array<{ name: string; description: string; bytes: number }>
  redactions: Array<{ kind: string; count: number }>
  estimatedBytes: number
  maxBytes: number
  eventCount: number
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

export interface NormalizedPoint {
  x: number
  y: number
}

export type AutomationOrientation = 'any' | 'portrait' | 'landscape'

export type DeviceCondition =
  | { type: 'orientation'; value: Exclude<AutomationOrientation, 'any'> }
  | { type: 'aspect-ratio'; value: number; tolerance: number }

export type AutomationStep =
  | { type: 'delay'; durationMs: number }
  | { type: 'control'; action: DeviceControlAction }
  | { type: 'tap'; x: number; y: number; coordinateSpace: 'normalized' }
  | { type: 'swipe'; from: NormalizedPoint; to: NormalizedPoint; durationMs: number; coordinateSpace: 'normalized' }
  | { type: 'text'; value: string; sensitive: false }
  | { type: 'start-app'; packageId: string }
  | { type: 'screenshot'; label?: string }
  | { type: 'assert-device'; condition: DeviceCondition }

export interface AutomationMacro {
  id: string
  name: string
  description: string
  schemaVersion: 2
  design: {
    orientation: AutomationOrientation
    aspectRatio: number
  }
  steps: AutomationStep[]
}

export interface AutomationImportPreview {
  token: string
  automation: AutomationMacro
  warnings: string[]
  dangerousStepCount: number
  trusted: false
}

export type BatchAction =
  | { type: 'launch'; launches: DeviceLaunch[] }
  | { type: 'control'; action: DeviceControlAction }
  | { type: 'screenshot' }
  | { type: 'start-app'; packageId: string }
  | { type: 'automation'; automation: AutomationMacro }
  | { type: 'file-push'; target: string; conflict: FileConflictPolicy }
  | { type: 'apk-install'; replace: boolean; downgrade: boolean }

export interface BatchPreflightRequest {
  serials: string[]
  action: BatchAction
  concurrencyLimit: number
}

export type BatchPreflightCheck = 'pass' | 'warning' | 'fail'

export interface BatchPreflightItem {
  serial: string
  online: boolean
  authorized: boolean
  capability: BatchPreflightCheck
  sessionConflict: boolean
  eligible: boolean
  estimatedAction: string
  reasons: string[]
}

export interface BatchPreflight {
  token: string
  createdAt: string
  expiresAt: string
  actionType: BatchAction['type']
  confirmationRequired: boolean
  confirmationKind?: 'input' | 'overwrite' | 'downgrade'
  items: BatchPreflightItem[]
}

export type BatchRunState = 'running' | 'completed' | 'partial' | 'failed' | 'canceled'

export interface BatchActionResult {
  serial: string
  actionType: BatchAction['type']
  message: string
  artifactId?: string
  sessionIds?: string[]
  completedSteps?: number
}

export interface BatchRunReport extends BatchOperationResult<BatchActionResult> {
  actionType: BatchAction['type']
  state: BatchRunState
  canceled: boolean
}

export interface BatchRunEvent {
  runId: string
  actionType: BatchAction['type']
  targetId?: string
  stepIndex?: number
  stepType?: AutomationStep['type']
  status: 'started' | 'step-start' | 'step-success' | 'step-failure' | 'step-skipped' | 'target-success' | 'target-failure' | 'canceled' | 'completed'
  timestamp: string
  message: string
  report?: BatchRunReport
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
  groups: DeviceGroupView[]
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
  defaultProfileId?: string
  concurrencyLimit: number
  description: string
}

export interface DeviceGroupView {
  id: string
  name: string
  serials: string[]
  defaultProfileId?: string
  concurrencyLimit: number
  description: string
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

export interface EncoderInfo {
  kind: 'video' | 'audio'
  codec: string
  name: string
  implementation: 'hw' | 'sw' | 'hybrid' | 'unknown'
  vendor: boolean
  aliasFor?: string
}

export interface DisplayInfo {
  id: number
  width?: number
  height?: number
}

export interface CameraSizeInfo {
  width: number
  height: number
  highSpeed: boolean
  fps: number[]
}

export interface CameraInfo {
  id: string
  facing: 'front' | 'back' | 'external' | 'unknown'
  sensorWidth: number
  sensorHeight: number
  fps: number[]
  zoomRange?: { min: number; max: number }
  sizes: CameraSizeInfo[]
}

export interface DeviceCapabilitySnapshot {
  serial: string
  capturedAt: string
  cached: boolean
  videoEncoders: EncoderInfo[]
  audioEncoders: EncoderInfo[]
  displays: DisplayInfo[]
  cameras: CameraInfo[]
  errors: Partial<Record<'encoders' | 'displays' | 'cameras' | 'cameraSizes', string>>
}

export interface OperationResult<T = undefined> {
  ok: boolean
  data?: T
  error?: StructuredError
  requestId?: string
}

export interface StructuredError {
  code: string
  stage: string
  message: string
  detail?: string
  exitCode?: number
  retryable: boolean
  suggestedActions: string[]
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
  listEvents(query: AppEventQuery): Promise<AppEvent[]>
  clearEvents(): Promise<void>
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
  preview(launches: CommandPreviewRequest[]): Promise<OperationResult<CommandPreview[]>>
  startOtg(runtime: RuntimeConfig, launch: LaunchConfig, usbSerial: string): Promise<OperationResult<string>>
  previewOtg(launch: LaunchConfig, usbSerial: string): Promise<OperationResult<CommandPreview>>
  listSessions(): Promise<ScrcpySession[]>
  stopSession(id: string): Promise<OperationResult>
  stop(serial: string): Promise<OperationResult>
  control(runtime: RuntimeConfig, serial: string, action: DeviceControlAction): Promise<OperationResult<string>>
  screenshot(runtime: RuntimeConfig, serial: string): Promise<OperationResult<string>>
  previewAutomationImport(): Promise<OperationResult<AutomationImportPreview>>
  commitAutomationImport(token: string): Promise<OperationResult<AutomationMacro>>
  exportAutomation(automation: AutomationMacro): Promise<OperationResult<string>>
  preflightBatch(runtime: RuntimeConfig, request: BatchPreflightRequest): Promise<OperationResult<BatchPreflight>>
  startBatch(runtime: RuntimeConfig, token: string, passingOnly: boolean, confirmedDangerous: boolean): Promise<OperationResult<string>>
  cancelBatch(runId: string): Promise<OperationResult>
  getDeviceOverview(runtime: RuntimeConfig, serial: string): Promise<OperationResult<DeviceOverview>>
  pushFiles(runtime: RuntimeConfig, serials: string[], target: string, conflict: FileConflictPolicy): Promise<OperationResult<BatchOperationResult<FileTransferResult>>>
  installApk(runtime: RuntimeConfig, serials: string[], replace: boolean, downgrade: boolean): Promise<OperationResult<BatchOperationResult<ApkInstallResult>>>
  listApps(runtime: RuntimeConfig, serial: string, refresh: boolean): Promise<OperationResult<InstalledApp[]>>
  startApp(runtime: RuntimeConfig, serial: string, packageId: string): Promise<OperationResult<string>>
  listArtifacts(query: ArtifactQuery): Promise<OperationResult<ArtifactRecord[]>>
  openArtifact(id: string): Promise<OperationResult>
  revealArtifact(id: string): Promise<OperationResult>
  copyArtifactPath(id: string): Promise<OperationResult>
  deleteArtifact(id: string, deleteFile: boolean): Promise<OperationResult>
  previewDiagnostics(runtime: RuntimeConfig): Promise<OperationResult<DiagnosticPreview>>
  exportDiagnostics(runtime: RuntimeConfig): Promise<OperationResult<ArtifactRecord>>
  openIssueHelper(artifactId?: string): Promise<OperationResult>
  exportProfile(profile: LaunchProfile): Promise<OperationResult<string>>
  previewProfileImport(runtime: RuntimeConfig): Promise<OperationResult<ProfileImportPreview>>
  commitProfileImport(token: string, strategy: ProfileImportStrategy, keepMachinePaths: boolean): Promise<OperationResult<ProfileImportCommit>>
  probeDeviceCapabilities(runtime: RuntimeConfig, serial: string, refresh?: boolean): Promise<OperationResult<DeviceCapabilitySnapshot>>
  setMinimizeToTray(enabled: boolean): Promise<void>
  setQuitBehavior(runtime: RuntimeConfig, killAdbOnQuit: boolean): Promise<void>
  setBossKey(enabled: boolean, accelerator: string): Promise<OperationResult<string>>
  openExternal(url: string): Promise<void>
  onStatus(callback: (event: ScrcpyStatusEvent) => void): () => void
  onSession(callback: (event: ScrcpySessionEvent) => void): () => void
  onDevices(callback: (event: DeviceTrackerEvent) => void): () => void
  onEvent(callback: (event: AppEvent) => void): () => void
  onBatchProgress(callback: (event: BatchProgressEvent) => void): () => void
  onBatchRun(callback: (event: BatchRunEvent) => void): () => void
}

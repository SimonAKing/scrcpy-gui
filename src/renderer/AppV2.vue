<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, toRaw, watch } from 'vue'
import type {
  AutomationMacro,
  AutomationStep,
  AppEvent,
  AppEventDomain,
  AppEventLevel,
  ApkInstallResult,
  ArtifactKind,
  ArtifactRecord,
  BatchItemResult,
  BatchProgressEvent,
  CapabilitySnapshot,
  CommandPreview,
  Device,
  DeviceControlAction,
  DeviceOverview,
  DeviceTrackerEvent,
  EnvironmentStatus,
  DiagnosticPreview,
  FileConflictPolicy,
  FileTransferResult,
  InstalledApp,
  LaunchConfig,
  LaunchProfile,
  PersistedConfig,
  ScrcpySession,
  ScrcpySessionEvent,
  ScrcpyStatusEvent,
  StructuredError,
  WirelessTarget
} from '../shared/types'
import { defaultPersistedConfig, legacyConfigView } from '../shared/config'
import { operationErrorMessage } from '../shared/errors'
import { translate } from './i18n'

type Tab = 'devices' | 'sessions' | 'artifacts' | 'settings' | 'logs'
type SettingsSection = 'general' | 'video' | 'controls' | 'recording' | 'geometry' | 'advanced'
type WorkspaceSection = 'overview' | 'control' | 'apps' | 'files'
type ToastKind = 'success' | 'error' | 'info'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

const STORAGE_KEY = 'scrcpy-gui:config:v2'
const MIGRATION_KEY = 'scrcpy-gui:config:v3-migrated'

const controlActions: DeviceControlAction[] = [
  'back',
  'home',
  'app-switch',
  'menu',
  'volume-down',
  'volume-up',
  'power',
  'screen-off',
  'screen-on',
  'rotate',
  'auto-rotate',
  'show-touches-on',
  'show-touches-off'
]

function detectedLocale(): PersistedConfig['locale'] {
  const locale = navigator.language.toLowerCase()
  if (locale.includes('zh-tw') || locale.includes('zh-hk')) return 'zh-TW'
  if (locale.startsWith('ru')) return 'ru'
  return locale.startsWith('zh') ? 'zh-CN' : 'en'
}

function loadLegacyConfig(): PersistedConfig {
  try {
    return legacyConfigView(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'), detectedLocale())
  } catch {
    return defaultPersistedConfig(detectedLocale())
  }
}

const config = reactive(loadLegacyConfig())
const activeTab = ref<Tab>('devices')
const activeSettingsSection = ref<SettingsSection>('general')
const version = ref('2.0.0')
const environment = ref<EnvironmentStatus | null>(null)
const devices = ref<Device[]>([])
const selectedSerials = ref<string[]>([])
const commandPreviews = ref<CommandPreview[]>([])
const sessions = ref<ScrcpySession[]>([])
const artifacts = ref<ArtifactRecord[]>([])
const artifactKind = ref<ArtifactKind | 'all'>('all')
const artifactDevice = ref('all')
const loadingArtifacts = ref(false)
const diagnosticPreview = ref<DiagnosticPreview | null>(null)
const preparingDiagnostics = ref(false)
const diagnosticArtifact = ref<ArtifactRecord | null>(null)
const activeSerials = ref(new Set<string>())
const loadingEnvironment = ref(false)
const loadingDevices = ref(false)
const wirelessTarget = ref(config.wirelessTargets[0]?.address || '')
const pairTarget = ref('')
const pairingCode = ref('')
const profileName = ref('')
const controlSerial = ref('')
const workspaceSection = ref<WorkspaceSection>('overview')
const deviceOverview = ref<DeviceOverview | null>(null)
const loadingOverview = ref(false)
const installedApps = ref<InstalledApp[]>([])
const loadingApps = ref(false)
const appSearch = ref('')
const showSystemApps = ref(false)
const fileTarget = ref(config.launch.pushTarget || '/sdcard/Download/')
const fileConflict = ref<FileConflictPolicy>('replace')
const installReplace = ref(true)
const installDowngrade = ref(false)
const workspaceBusy = ref(false)
const workspaceResults = ref<Array<BatchItemResult<FileTransferResult | ApkInstallResult>>>([])
const workspaceProgress = ref<BatchProgressEvent[]>([])
const recordingAutomation = ref(false)
const recordedSteps = ref<AutomationStep[]>([])
const automationName = ref('')
const replayingAutomation = ref('')
const logs = ref<AppEvent[]>([])
const logLevel = ref<AppEventLevel | 'all'>('all')
const logDomain = ref<AppEventDomain | 'all'>('all')
const toasts = ref<Toast[]>([])
let toastId = 0
let removeStatusListener: (() => void) | undefined
let removeSessionListener: (() => void) | undefined
let removeDeviceListener: (() => void) | undefined
let removeAppEventListener: (() => void) | undefined
let removeBatchProgressListener: (() => void) | undefined
let lastRecordedActionAt = 0
let configRevision = 0
let configReady = false
let configSaveInFlight = false
let configSavePending = false
const autoLaunchAttempted = new Set<string>()
const trackerStatus = ref<DeviceTrackerEvent['status']>('stopped')
const trackerSource = ref<DeviceTrackerEvent['source']>('track')

const t = (key: string): string => translate(config.locale, key)
const runtimeVersion = (binary: 'scrcpy' | 'adb'): string => {
  const value = environment.value?.[binary].version || ''
  const match = binary === 'scrcpy'
    ? value.match(/^scrcpy\s+([^\s]+)/i)
    : value.match(/\bversion\s+([^\s]+)/i)
  return match?.[1] || value || t('notFound')
}
const usableDevices = computed(() => devices.value.filter((device) => device.state === 'device'))
const allSelected = computed(() =>
  usableDevices.value.length > 0 && usableDevices.value.every((device) => selectedSerials.value.includes(device.serial))
)
const controlDevice = computed(() => devices.value.find((device) => device.serial === controlSerial.value))
const workspaceTargets = computed(() => {
  const available = new Set(usableDevices.value.map((device) => device.serial))
  const selected = selectedSerials.value.filter((serial) => available.has(serial))
  return selected.length ? selected : controlSerial.value ? [controlSerial.value] : []
})
const visibleApps = computed(() => {
  const query = appSearch.value.trim().toLocaleLowerCase()
  return installedApps.value.filter((item) => item.launchable && (showSystemApps.value || !item.system) &&
    (!query || item.packageId.toLocaleLowerCase().includes(query) || item.label.toLocaleLowerCase().includes(query)))
})
const settingsSections: SettingsSection[] = ['general', 'video', 'controls', 'recording', 'geometry', 'advanced']
const capabilityFeatureKeys: Array<keyof CapabilitySnapshot['features']> = [
  'screen', 'camera', 'virtualDisplay', 'recordOnly', 'controlOnly', 'otg', 'v4l2', 'appLaunch'
]
const availableCapabilities = computed(() => {
  const features = environment.value?.scrcpy.capabilities?.features
  return features ? capabilityFeatureKeys.filter((feature) => features[feature]) : []
})
const visibleLogs = computed(() => logs.value.filter((event) =>
  (logLevel.value === 'all' || event.level === logLevel.value) &&
  (logDomain.value === 'all' || event.domain === logDomain.value)
))
const visibleArtifacts = computed(() => artifacts.value.filter((artifact) =>
  (artifactKind.value === 'all' || artifact.kind === artifactKind.value) &&
  (artifactDevice.value === 'all' || artifact.deviceId === artifactDevice.value)
))
const artifactKinds: ArtifactKind[] = ['screenshot', 'recording', 'transfer-report', 'diagnostic']
const artifactDevices = computed(() => [...new Set(artifacts.value.map((artifact) => artifact.deviceId).filter(Boolean) as string[])])
const eventLevels: AppEventLevel[] = ['debug', 'info', 'warn', 'error']
const eventDomains: AppEventDomain[] = ['runtime', 'device', 'session', 'config', 'automation', 'artifact', 'update']

const runtimeSnapshot = () => ({ scrcpyPath: config.runtime.scrcpyPath })
const launchSnapshot = (serial?: string): LaunchConfig => {
  const profileId = serial ? config.deviceProfiles[serial] : ''
  const profile = profileId ? config.profiles.find((item) => item.id === profileId) : undefined
  const launch = structuredClone(toRaw(profile?.launch || config.launch))
  const alias = serial ? config.deviceAliases[serial]?.trim() : ''
  if (alias && !launch.windowTitle.trim()) launch.windowTitle = alias
  return launch
}

async function persistConfig(): Promise<void> {
  if (!configReady) return
  if (configSaveInFlight) {
    configSavePending = true
    return
  }
  configSaveInFlight = true
  const snapshot = structuredClone(toRaw(config))
  const result = await window.scrcpy.saveConfig(configRevision, snapshot)
  if (result.ok && result.data) configRevision = result.data.revision
  else toast('error', operationErrorMessage(result, t('configSaveFailed')))
  configSaveInFlight = false
  if (configSavePending) {
    configSavePending = false
    await persistConfig()
  }
}

watch(
  config,
  () => void persistConfig(),
  { deep: true }
)

watch(
  [selectedSerials, () => config.launch, () => config.profiles, () => config.deviceProfiles, () => config.deviceAliases],
  () => { commandPreviews.value = [] },
  { deep: true }
)

watch(
  () => config.minimizeToTray,
  (enabled) => { if (configReady) void window.scrcpy.setMinimizeToTray(enabled) }
)

watch(
  [() => config.killAdbOnQuit, () => config.runtime.scrcpyPath],
  () => { if (configReady) void window.scrcpy.setQuitBehavior(runtimeSnapshot(), config.killAdbOnQuit) }
)

watch(
  () => config.bossKeyEnabled,
  () => { if (configReady) void applyBossKey(true) }
)

watch(usableDevices, (nextDevices) => {
  if (!nextDevices.some((device) => device.serial === controlSerial.value)) {
    controlSerial.value = nextDevices[0]?.serial || ''
  }
})

watch(controlSerial, () => {
  deviceOverview.value = null
  installedApps.value = []
  workspaceResults.value = []
  if (controlSerial.value) void loadDeviceOverview()
})

watch(activeTab, (tab) => {
  if (tab === 'artifacts') void loadArtifacts()
})

function toast(kind: ToastKind, message: string): void {
  if (config.muteNotifications) return
  const id = ++toastId
  toasts.value.push({ id, kind, message })
  window.setTimeout(() => {
    toasts.value = toasts.value.filter((item) => item.id !== id)
  }, kind === 'error' ? 6000 : 2800)
}

async function refreshEnvironment(notify = false): Promise<void> {
  loadingEnvironment.value = true
  environment.value = await window.scrcpy.getEnvironment(runtimeSnapshot())
  loadingEnvironment.value = false
  if (notify && environment.value.scrcpy.ok && environment.value.adb.ok) toast('success', t('environmentReady'))
}

async function chooseScrcpy(): Promise<void> {
  const path = await window.scrcpy.chooseScrcpy()
  if (!path) return
  config.runtime.scrcpyPath = path
  await refreshEnvironment(true)
  await refreshDevices()
  await startTrackingDevices()
}

async function refreshDevices(notifyError = false): Promise<void> {
  if (loadingDevices.value) return
  loadingDevices.value = true
  const result = await window.scrcpy.listDevices(runtimeSnapshot())
  loadingDevices.value = false
  if (!result.ok) {
    devices.value = []
    if (notifyError) toast('error', operationErrorMessage(result, t('operationFailed')))
    return
  }
  await applyDeviceSnapshot(result.data || [])
}

async function applyDeviceSnapshot(nextDevices: Device[]): Promise<void> {
  devices.value = [...new Map(nextDevices.map((device) => [device.serial, device])).values()]
  const available = new Set(devices.value.map((device) => device.serial))
  selectedSerials.value = selectedSerials.value.filter((serial) => available.has(serial))
  for (const serial of autoLaunchAttempted) {
    if (!available.has(serial)) autoLaunchAttempted.delete(serial)
  }
  if (config.autoSelectFirstDevice && !selectedSerials.value.length) {
    const first = devices.value.find((device) => device.state === 'device')
    if (first) selectedSerials.value = [first.serial]
  }
  if (environment.value?.scrcpy.ok) {
    for (const device of devices.value.filter((item) => item.state === 'device' && config.autoLaunchDevices[item.serial])) {
      if (autoLaunchAttempted.has(device.serial) || activeSerials.value.has(device.serial)) continue
      autoLaunchAttempted.add(device.serial)
      const startResult = await window.scrcpy.start(runtimeSnapshot(), [{ serial: device.serial, launch: launchSnapshot(device.serial) }])
      if (!startResult.ok) toast('error', operationErrorMessage(startResult, t('operationFailed')))
    }
  }
}

async function handleDeviceEvent(event: DeviceTrackerEvent): Promise<void> {
  trackerStatus.value = event.status
  trackerSource.value = event.source
  if (event.status === 'tracking' && event.revision > 0) await applyDeviceSnapshot(event.devices)
}

async function startTrackingDevices(): Promise<void> {
  const result = await window.scrcpy.trackDevices(runtimeSnapshot())
  if (!result.ok) {
    trackerStatus.value = 'error'
    toast('error', operationErrorMessage(result, t('trackerFailed')))
    return
  }
  await applyDeviceSnapshot(result.data || [])
}

function handleVisibilityChange(): void {
  void window.scrcpy.setDeviceTrackerVisibility(!document.hidden)
}

function toggleSelectAll(): void {
  selectedSerials.value = allSelected.value ? [] : usableDevices.value.map((device) => device.serial)
}

async function launchSelected(): Promise<void> {
  const launches = selectedSerials.value.map((serial) => ({ serial, launch: launchSnapshot(serial) }))
  const result = await window.scrcpy.start(runtimeSnapshot(), launches)
  if (!result.ok) toast('error', operationErrorMessage(result, t('operationFailed')))
}

async function previewSelected(): Promise<void> {
  const launches = selectedSerials.value.map((serial) => {
    const profileId = config.deviceProfiles[serial]
    const profile = profileId ? config.profiles.find((item) => item.id === profileId) : undefined
    const baseLaunch = profile?.launch || config.launch
    return {
      serial,
      launch: launchSnapshot(serial),
      source: profile ? 'profile' as const : 'global' as const,
      profileName: profile?.name,
      deviceWindowTitleOverride: Boolean(config.deviceAliases[serial]?.trim() && !baseLaunch.windowTitle.trim())
    }
  })
  const result = await window.scrcpy.preview(launches)
  if (!result.ok) {
    toast('error', operationErrorMessage(result, t('commandPreviewFailed')))
    return
  }
  commandPreviews.value = result.data || []
}

function previewLabel(serial: string): string {
  return config.deviceAliases[serial]?.trim() || devices.value.find((device) => device.serial === serial)?.model || serial
}

function previewArgv(preview: CommandPreview): string {
  return JSON.stringify(['scrcpy', ...preview.args])
}

function previewSource(detail: CommandPreview['details'][number]): string {
  if (detail.source === 'profile' && detail.sourceLabel) return `${t('sourceProfile')}: ${detail.sourceLabel}`
  return t(`source_${detail.source}`)
}

async function stop(serial: string): Promise<void> {
  const result = await window.scrcpy.stop(serial)
  if (!result.ok) toast('error', operationErrorMessage(result, t('operationFailed')))
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function rememberWirelessTarget(address: string): void {
  const normalized = address.trim()
  if (!normalized || config.wirelessTargets.some((target) => target.address === normalized)) return
  config.wirelessTargets.push({ id: newId(), name: normalized, address: normalized, autoConnect: false })
}

async function connect(address = wirelessTarget.value, notify = true): Promise<boolean> {
  const target = address.trim()
  const result = await window.scrcpy.connect(runtimeSnapshot(), target)
  if (!result.ok) {
    if (notify) toast('error', operationErrorMessage(result, t('operationFailed')))
    return false
  }
  wirelessTarget.value = target
  rememberWirelessTarget(target)
  if (notify) toast('success', t('connected'))
  await refreshDevices()
  return true
}

async function connectSaved(target: WirelessTarget): Promise<void> {
  await connect(target.address)
}

function forgetWirelessTarget(id: string): void {
  const index = config.wirelessTargets.findIndex((target) => target.id === id)
  if (index >= 0) config.wirelessTargets.splice(index, 1)
}

async function pair(): Promise<void> {
  const result = await window.scrcpy.pair(runtimeSnapshot(), pairTarget.value, pairingCode.value)
  if (!result.ok) {
    toast('error', operationErrorMessage(result, t('operationFailed')))
    return
  }
  pairingCode.value = ''
  toast('success', t('paired'))
}

async function disconnect(serial: string): Promise<void> {
  const result = await window.scrcpy.disconnect(runtimeSnapshot(), serial)
  if (!result.ok) {
    toast('error', operationErrorMessage(result, t('operationFailed')))
    return
  }
  toast('success', t('disconnected'))
  await refreshDevices()
}

async function setWorkspaceSection(section: WorkspaceSection): Promise<void> {
  workspaceSection.value = section
  workspaceResults.value = []
  if (section === 'overview' && !deviceOverview.value) await loadDeviceOverview()
  if (section === 'apps' && !installedApps.value.length) await loadInstalledApps()
}

async function loadDeviceOverview(): Promise<void> {
  if (!controlSerial.value || loadingOverview.value) return
  loadingOverview.value = true
  const result = await window.scrcpy.getDeviceOverview(runtimeSnapshot(), controlSerial.value)
  loadingOverview.value = false
  if (result.ok) deviceOverview.value = result.data || null
  else toast('error', operationErrorMessage(result, t('deviceOverviewFailed')))
}

async function loadInstalledApps(refresh = false): Promise<void> {
  if (!controlSerial.value || loadingApps.value) return
  loadingApps.value = true
  const result = await window.scrcpy.listApps(runtimeSnapshot(), controlSerial.value, refresh)
  loadingApps.value = false
  if (result.ok) installedApps.value = result.data || []
  else toast('error', operationErrorMessage(result, t('appListFailed')))
}

async function startInstalledApp(app: InstalledApp): Promise<void> {
  if (!controlSerial.value) return
  const result = await window.scrcpy.startApp(runtimeSnapshot(), controlSerial.value, app.packageId)
  if (result.ok) toast('success', `${t('appStarted')} ${app.packageId}`)
  else toast('error', operationErrorMessage(result, t('appStartFailed')))
}

function summarizeWorkspaceResults(): void {
  const failed = workspaceResults.value.filter((result) => !result.ok).length
  const skipped = workspaceResults.value.filter((result) =>
    result.ok && result.data && 'skipped' in result.data && result.data.skipped
  ).length
  if (failed) toast('error', `${failed} ${t('batchItemsFailed')}`)
  else toast('success', `${workspaceResults.value.length - skipped} ${t('batchItemsCompleted')}${skipped ? ` · ${skipped} ${t('skipped')}` : ''}`)
}

async function pushSelectedFiles(): Promise<void> {
  if (!workspaceTargets.value.length || workspaceBusy.value) return
  workspaceResults.value = []
  workspaceProgress.value = []
  workspaceBusy.value = true
  const result = await window.scrcpy.pushFiles(runtimeSnapshot(), workspaceTargets.value, fileTarget.value, fileConflict.value)
  workspaceBusy.value = false
  if (!result.ok) {
    if (result.error?.code !== 'FILE_SELECTION_CANCELED') toast('error', operationErrorMessage(result, t('filePushFailed')))
    return
  }
  config.launch.pushTarget = fileTarget.value
  workspaceResults.value = result.data?.results || []
  summarizeWorkspaceResults()
}

async function installSelectedApk(): Promise<void> {
  if (!workspaceTargets.value.length || workspaceBusy.value) return
  if (installDowngrade.value && !window.confirm(t('confirmDowngrade'))) return
  workspaceResults.value = []
  workspaceProgress.value = []
  workspaceBusy.value = true
  const result = await window.scrcpy.installApk(
    runtimeSnapshot(), workspaceTargets.value, installReplace.value, installDowngrade.value
  )
  workspaceBusy.value = false
  if (!result.ok) {
    if (result.error?.code !== 'APK_SELECTION_CANCELED') toast('error', operationErrorMessage(result, t('apkInstallFailed')))
    return
  }
  workspaceResults.value = result.data?.results || []
  summarizeWorkspaceResults()
}

function workspaceResultMessage(result: BatchItemResult<FileTransferResult | ApkInstallResult>): string {
  if (!result.ok) return result.error?.message || t('operationFailed')
  if (result.data && 'skipped' in result.data && result.data.skipped) return t('skippedExisting')
  return result.data?.output || t('completed')
}

function handleBatchProgress(event: BatchProgressEvent): void {
  if (workspaceProgress.value.length && workspaceProgress.value[0].batchId !== event.batchId) workspaceProgress.value = []
  const index = workspaceProgress.value.findIndex((item) => item.targetId === event.targetId)
  if (index >= 0) workspaceProgress.value[index] = event
  else workspaceProgress.value.push(event)
}

function formatBytes(size: number): string {
  if (size < 1_024) return `${size} B`
  if (size < 1_024 * 1_024) return `${(size / 1_024).toFixed(1)} KiB`
  return `${(size / (1_024 * 1_024)).toFixed(1)} MiB`
}

async function loadArtifacts(): Promise<void> {
  if (loadingArtifacts.value) return
  loadingArtifacts.value = true
  const result = await window.scrcpy.listArtifacts({ limit: 5_000 })
  loadingArtifacts.value = false
  if (result.ok) artifacts.value = result.data || []
  else toast('error', operationErrorMessage(result, t('artifactListFailed')))
}

function artifactDeviceLabel(artifact: ArtifactRecord): string {
  if (!artifact.deviceId) return t('notApplicable')
  return config.deviceAliases[artifact.deviceId]?.trim() || artifact.deviceId
}

async function openArtifact(artifact: ArtifactRecord): Promise<void> {
  const result = await window.scrcpy.openArtifact(artifact.id)
  if (!result.ok) toast('error', operationErrorMessage(result, t('artifactOpenFailed')))
}

async function revealArtifact(artifact: ArtifactRecord): Promise<void> {
  const result = await window.scrcpy.revealArtifact(artifact.id)
  if (!result.ok) toast('error', operationErrorMessage(result, t('artifactRevealFailed')))
}

async function copyArtifactPath(artifact: ArtifactRecord): Promise<void> {
  const result = await window.scrcpy.copyArtifactPath(artifact.id)
  if (result.ok) toast('success', t('artifactPathCopied'))
  else toast('error', operationErrorMessage(result, t('artifactCopyFailed')))
}

async function deleteArtifact(artifact: ArtifactRecord, deleteFile: boolean): Promise<void> {
  const result = await window.scrcpy.deleteArtifact(artifact.id, deleteFile)
  if (!result.ok) {
    if (result.error?.code === 'ARTIFACT_DELETE_CANCELED') return
    toast('error', operationErrorMessage(result, t('artifactDeleteFailed')))
    return
  }
  artifacts.value = artifacts.value.filter((item) => item.id !== artifact.id)
  toast('success', deleteFile ? t('artifactFileDeleted') : t('artifactIndexDeleted'))
}

async function previewDiagnostics(): Promise<void> {
  if (preparingDiagnostics.value) return
  preparingDiagnostics.value = true
  const result = await window.scrcpy.previewDiagnostics(runtimeSnapshot())
  preparingDiagnostics.value = false
  if (result.ok) diagnosticPreview.value = result.data || null
  else toast('error', operationErrorMessage(result, t('diagnosticPreviewFailed')))
}

async function exportDiagnostics(): Promise<void> {
  if (!diagnosticPreview.value || preparingDiagnostics.value) return
  preparingDiagnostics.value = true
  const result = await window.scrcpy.exportDiagnostics(runtimeSnapshot())
  preparingDiagnostics.value = false
  if (!result.ok) {
    if (result.error?.code !== 'DIAGNOSTIC_EXPORT_CANCELED') toast('error', operationErrorMessage(result, t('diagnosticExportFailed')))
    return
  }
  diagnosticArtifact.value = result.data || null
  if (result.data) artifacts.value = [result.data, ...artifacts.value.filter((item) => item.id !== result.data?.id)]
  toast('success', t('diagnosticExported'))
}

async function openIssueHelper(artifact: ArtifactRecord | null = diagnosticArtifact.value): Promise<void> {
  const result = await window.scrcpy.openIssueHelper(artifact?.id)
  if (!result.ok) toast('error', operationErrorMessage(result, t('issueHelperFailed')))
}

async function chooseRecordPath(): Promise<void> {
  const path = await window.scrcpy.chooseRecordPath()
  if (path) config.launch.recordPath = path
}

async function chooseRecordDirectory(): Promise<void> {
  const path = await window.scrcpy.chooseRecordDirectory()
  if (path) config.launch.recordDirectory = path
}

function saveProfile(): void {
  const name = profileName.value.trim()
  if (!name) {
    toast('error', t('profileNameRequired'))
    return
  }
  config.profiles.push({ id: newId(), name, launch: launchSnapshot() })
  profileName.value = ''
  toast('success', t('profileSaved'))
}

function applyProfile(profile: LaunchProfile): void {
  Object.assign(config.launch, structuredClone(toRaw(profile.launch)))
  toast('success', t('profileApplied'))
}

function updateProfile(profile: LaunchProfile): void {
  profile.launch = launchSnapshot()
  toast('success', t('profileUpdated'))
}

function deleteProfile(id: string): void {
  const index = config.profiles.findIndex((profile) => profile.id === id)
  if (index >= 0) config.profiles.splice(index, 1)
  for (const [serial, profileId] of Object.entries(config.deviceProfiles)) {
    if (profileId === id) delete config.deviceProfiles[serial]
  }
}

function assignProfile(serial: string, event: Event): void {
  const profileId = (event.target as HTMLSelectElement).value
  if (profileId) config.deviceProfiles[serial] = profileId
  else delete config.deviceProfiles[serial]
}

function actionLabel(action: DeviceControlAction): string {
  const keys: Record<DeviceControlAction, string> = {
    back: 'actionBack', home: 'actionHome', 'app-switch': 'actionAppSwitch', menu: 'actionMenu',
    'volume-up': 'actionVolumeUp', 'volume-down': 'actionVolumeDown', power: 'actionPower',
    'screen-on': 'actionScreenOn', 'screen-off': 'actionScreenOff', rotate: 'actionRotate', 'auto-rotate': 'actionAutoRotate',
    'show-touches-on': 'actionTouchesOn', 'show-touches-off': 'actionTouchesOff'
  }
  return t(keys[action])
}

async function sendControlAction(action: DeviceControlAction): Promise<void> {
  if (!controlSerial.value) return
  const actionAt = Date.now()
  const result = await window.scrcpy.control(runtimeSnapshot(), controlSerial.value, action)
  if (!result.ok) {
    toast('error', operationErrorMessage(result, t('operationFailed')))
    return
  }
  if (recordingAutomation.value) {
    const delayMs = lastRecordedActionAt ? Math.min(60_000, actionAt - lastRecordedActionAt) : 0
    recordedSteps.value.push({ action, delayMs })
    lastRecordedActionAt = actionAt
  }
}

async function takeScreenshot(): Promise<void> {
  if (!controlSerial.value) return
  const result = await window.scrcpy.screenshot(runtimeSnapshot(), controlSerial.value)
  if (!result.ok) {
    if (result.error?.code !== 'SCREENSHOT_CANCELED') toast('error', operationErrorMessage(result, t('operationFailed')))
    return
  }
  toast('success', `${t('screenshotSaved')} ${result.data}`)
}

function startAutomationRecording(): void {
  recordedSteps.value = []
  automationName.value = ''
  lastRecordedActionAt = 0
  recordingAutomation.value = true
}

function stopAutomationRecording(): void {
  recordingAutomation.value = false
}

function saveAutomation(): void {
  const name = automationName.value.trim() || `${t('automation')} ${config.automations.length + 1}`
  if (!recordedSteps.value.length) {
    toast('error', t('automationEmpty'))
    return
  }
  const macro: AutomationMacro = { id: newId(), name, steps: structuredClone(toRaw(recordedSteps.value)) }
  config.automations.push(macro)
  recordedSteps.value = []
  automationName.value = ''
  toast('success', t('automationSaved'))
}

async function replayAutomation(macro: AutomationMacro): Promise<void> {
  if (!controlSerial.value || replayingAutomation.value) return
  replayingAutomation.value = macro.id
  const result = await window.scrcpy.runAutomation(runtimeSnapshot(), controlSerial.value, structuredClone(toRaw(macro.steps)))
  replayingAutomation.value = ''
  if (!result.ok) toast('error', operationErrorMessage(result, t('operationFailed')))
  else toast('success', t('automationComplete'))
}

function deleteAutomation(id: string): void {
  const index = config.automations.findIndex((macro) => macro.id === id)
  if (index >= 0) config.automations.splice(index, 1)
}

async function applyBossKey(notify = false): Promise<void> {
  const result = await window.scrcpy.setBossKey(config.bossKeyEnabled, config.bossKeyAccelerator)
  if (notify && !result.ok) toast('error', operationErrorMessage(result, t('operationFailed')))
}

function resetSettings(): void {
  const defaults = defaultPersistedConfig(config.locale)
  Object.assign(config.launch, defaults.launch)
  config.muteNotifications = defaults.muteNotifications
  config.minimizeToTray = defaults.minimizeToTray
  config.killAdbOnQuit = defaults.killAdbOnQuit
  config.bossKeyEnabled = defaults.bossKeyEnabled
  config.bossKeyAccelerator = defaults.bossKeyAccelerator
  config.autoSelectFirstDevice = defaults.autoSelectFirstDevice
}

function openGithub(): void {
  void window.scrcpy.openExternal('https://github.com/SimonAKing/scrcpy-gui')
}

function handleStatus(event: ScrcpyStatusEvent): void {
  if (event.status === 'running') toast('success', `${event.serial}: ${t('launched')}`)
  if (event.status === 'stopped') toast('info', `${event.serial}: ${t('stopped')}`)
  if (event.status === 'error') toast('error', `${event.serial}: ${event.message}`)
}

function handleAppEvent(event: AppEvent): void {
  if (!logs.value.some((item) => item.id === event.id)) logs.value.push(event)
  if (logs.value.length > 1_000) logs.value.splice(0, logs.value.length - 1_000)
}

function eventError(event: AppEvent): StructuredError | undefined {
  const value = event.data?.error
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Partial<StructuredError>
  return typeof candidate.code === 'string' && typeof candidate.stage === 'string' &&
    typeof candidate.message === 'string' && typeof candidate.retryable === 'boolean' &&
    Array.isArray(candidate.suggestedActions)
    ? candidate as StructuredError
    : undefined
}

async function clearLogs(): Promise<void> {
  await window.scrcpy.clearEvents()
  logs.value = []
}

function sessionIsActive(session: ScrcpySession): boolean {
  return ['queued', 'preflighting', 'launching', 'running', 'stopping'].includes(session.state)
}

function syncActiveSerials(): void {
  activeSerials.value = new Set(sessions.value.filter(sessionIsActive).map((session) => session.serialAtLaunch))
}

function handleSession(event: ScrcpySessionEvent): void {
  const index = sessions.value.findIndex((session) => session.id === event.session.id)
  if (index >= 0) sessions.value[index] = event.session
  else sessions.value.unshift(event.session)
  syncActiveSerials()
}

async function stopSession(id: string): Promise<void> {
  const result = await window.scrcpy.stopSession(id)
  if (!result.ok) toast('error', operationErrorMessage(result, t('operationFailed')))
}

async function stopAllSessions(): Promise<void> {
  const results = await Promise.all(sessions.value.filter(sessionIsActive).map((session) => window.scrcpy.stopSession(session.id)))
  const failed = results.filter((result) => !result.ok)
  if (failed.length) toast('error', `${failed.length} ${t('sessionsStopFailed')}`)
}

function sessionDeviceLabel(session: ScrcpySession): string {
  return config.deviceAliases[session.serialAtLaunch]?.trim() || session.serialAtLaunch
}

function sessionArgv(session: ScrcpySession): string {
  return JSON.stringify(['scrcpy', ...session.args])
}

function deviceSessionState(serial: string): ScrcpySession['state'] | undefined {
  return sessions.value.find((session) => session.serialAtLaunch === serial && sessionIsActive(session))?.state
}

function statusLabel(device: Device): string {
  const sessionState = deviceSessionState(device.serial)
  if (sessionState) return t(`sessionState_${sessionState}`)
  if (device.state === 'device') return device.connection === 'usb' ? t('usb') : t('wireless')
  if (device.state === 'offline') return t('offline')
  return device.state
}

onMounted(async () => {
  try {
    const loaded = await window.scrcpy.loadConfig(localStorage.getItem(STORAGE_KEY) || '', detectedLocale())
    Object.assign(config, loaded.config)
    configRevision = loaded.revision
    localStorage.setItem(MIGRATION_KEY, JSON.stringify({ schemaVersion: 3, ...loaded.migration }))
    await nextTick()
    configReady = true
    if (loaded.migration.source === 'legacy-v2') {
      toast('success', `${t('configMigrated')} ${loaded.migration.imported}/${loaded.migration.skipped}/${loaded.migration.invalid}`)
    }
  } catch (error) {
    toast('error', `${t('configLoadFailed')} ${error instanceof Error ? error.message : String(error)}`)
  }
  version.value = await window.scrcpy.getVersion()
  removeStatusListener = window.scrcpy.onStatus(handleStatus)
  removeSessionListener = window.scrcpy.onSession(handleSession)
  removeDeviceListener = window.scrcpy.onDevices((event) => void handleDeviceEvent(event))
  removeAppEventListener = window.scrcpy.onEvent(handleAppEvent)
  removeBatchProgressListener = window.scrcpy.onBatchProgress(handleBatchProgress)
  const historicalEvents = await window.scrcpy.listEvents({ limit: 1_000 })
  const liveEventIds = new Set(logs.value.map((event) => event.id))
  logs.value.unshift(...historicalEvents.filter((event) => !liveEventIds.has(event.id)))
  logs.value.sort((left, right) => left.timestamp.localeCompare(right.timestamp))
  document.addEventListener('visibilitychange', handleVisibilityChange)
  handleVisibilityChange()
  const listedSessions = await window.scrcpy.listSessions()
  const liveIds = new Set(sessions.value.map((session) => session.id))
  sessions.value.push(...listedSessions.filter((session) => !liveIds.has(session.id)))
  syncActiveSerials()
  await window.scrcpy.setMinimizeToTray(config.minimizeToTray)
  await window.scrcpy.setQuitBehavior(runtimeSnapshot(), config.killAdbOnQuit)
  await applyBossKey()
  await refreshEnvironment()
  if (environment.value?.adb.ok) {
    for (const target of config.wirelessTargets.filter((item) => item.autoConnect)) {
      await connect(target.address, false)
    }
  }
  await refreshDevices()
  await startTrackingDevices()
})

onBeforeUnmount(() => {
  removeStatusListener?.()
  removeSessionListener?.()
  removeDeviceListener?.()
  removeAppEventListener?.()
  removeBatchProgressListener?.()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <button class="brand" type="button" @click="activeTab = 'devices'">
        <span class="brand-mark">S</span>
        <span><strong>Scrcpy GUI</strong><small>v{{ version }}</small></span>
      </button>
      <nav class="tabs" aria-label="Main navigation">
        <button v-for="tab in (['devices', 'sessions', 'artifacts', 'settings', 'logs'] as Tab[])" :key="tab" :class="{ active: activeTab === tab }" @click="activeTab = tab">
          {{ t(tab) }}
          <span v-if="tab === 'logs' && logs.length" class="count">{{ logs.length }}</span>
          <span v-else-if="tab === 'sessions' && sessions.filter(sessionIsActive).length" class="count">{{ sessions.filter(sessionIsActive).length }}</span>
        </button>
      </nav>
      <div class="top-actions">
        <select v-model="config.locale" aria-label="Language">
          <option value="en">English</option><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="ru">Русский</option>
        </select>
        <button class="secondary compact" @click="openGithub">{{ t('openGithub') }}</button>
      </div>
    </header>

    <main>
      <section v-if="activeTab === 'devices'" class="runtime-card">
        <div class="runtime-copy">
          <p class="eyebrow">{{ t('runtimeSetup') }}</p>
          <p class="muted">{{ t('runtimeHint') }}</p>
        </div>
        <div class="runtime-actions button-row nowrap">
          <button class="secondary compact" @click="chooseScrcpy">{{ t('chooseScrcpy') }}</button>
          <button class="ghost compact" :disabled="loadingEnvironment" @click="refreshEnvironment(true)">{{ t('recheck') }}</button>
        </div>
        <div class="runtime-statuses">
          <div :class="['runtime-status', environment?.scrcpy.ok ? 'ok' : 'bad']">
            <span class="runtime-status-name"><i />scrcpy</span>
            <code :title="environment?.scrcpy.version">{{ runtimeVersion('scrcpy') }}</code>
          </div>
          <div :class="['runtime-status', environment?.adb.ok ? 'ok' : 'bad']">
            <span class="runtime-status-name"><i />adb</span>
            <code :title="environment?.adb.version">{{ runtimeVersion('adb') }}</code>
          </div>
        </div>
        <div v-if="environment?.scrcpy.ok" class="runtime-capabilities">
          <span class="runtime-capabilities-label">{{ t('runtimeCapabilities') }}</span>
          <span v-for="feature in availableCapabilities" :key="feature" class="capability-pill">{{ t(`capability_${feature}`) }}</span>
          <span v-if="!availableCapabilities.length" class="muted">{{ t('capabilitiesUnavailable') }}</span>
        </div>
        <p v-if="environment?.scrcpy.capabilityError" class="inline-warning runtime-capability-error">{{ t('capabilityProbeFailed') }}</p>
      </section>

      <template v-if="activeTab === 'devices'">
        <section class="section-heading">
          <div><p class="eyebrow">{{ t('connectedDevices') }}</p><h1>{{ devices.length }} {{ t('devices').toLowerCase() }}</h1><p class="tracker-summary">{{ t(`tracker_${trackerStatus}`) }} · {{ trackerSource === 'track' ? t('trackerLive') : t('trackerPolling') }}</p></div>
          <div class="button-row">
            <button class="ghost" :disabled="loadingDevices" @click="refreshDevices(true)">{{ t('refresh') }}</button>
            <button class="ghost" :disabled="!usableDevices.length" @click="toggleSelectAll">{{ t('selectAll') }}</button>
            <button class="ghost" :disabled="!selectedSerials.length" @click="previewSelected">{{ t('previewCommand') }}</button>
            <button class="primary" :disabled="!selectedSerials.length || !environment?.scrcpy.ok" @click="launchSelected">{{ t('launchSelected') }}</button>
          </div>
        </section>

        <section v-if="devices.length" class="device-grid">
          <article v-for="device in devices" :key="device.serial" :class="['device-card', { selected: selectedSerials.includes(device.serial) }]">
            <label class="device-select">
              <input v-model="selectedSerials" type="checkbox" :value="device.serial" :disabled="device.state !== 'device'" />
              <span class="phone-icon">▯</span>
              <span class="device-copy"><strong>{{ config.deviceAliases[device.serial] || device.model }}</strong><code>{{ device.serial }}</code></span>
            </label>
            <div class="device-options">
              <label><span>{{ t('deviceAlias') }}</span><input v-model.trim="config.deviceAliases[device.serial]" :placeholder="device.model" /></label>
              <label><span>{{ t('launchProfile') }}</span><select :value="config.deviceProfiles[device.serial] || ''" @change="assignProfile(device.serial, $event)"><option value="">{{ t('globalSettings') }}</option><option v-for="profile in config.profiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option></select></label>
            </div>
            <label class="device-auto"><input v-model="config.autoLaunchDevices[device.serial]" type="checkbox" /><span>{{ t('autoLaunchDevice') }}</span></label>
            <div class="device-footer">
              <span :class="['status-dot', device.state, deviceSessionState(device.serial)]">{{ statusLabel(device) }}</span>
              <div class="button-row nowrap">
                <button v-if="activeSerials.has(device.serial)" class="danger compact" @click="stop(device.serial)">{{ t('stop') }}</button>
                <button v-if="device.connection === 'wireless'" class="ghost compact" @click="disconnect(device.serial)">{{ t('disconnect') }}</button>
              </div>
            </div>
            <p v-if="device.state === 'unauthorized'" class="inline-warning">{{ t('unauthorized') }}</p>
          </article>
        </section>
        <section v-else class="empty-state"><span class="empty-icon">⌁</span><p>{{ t('noDevices') }}</p></section>

        <section v-if="commandPreviews.length" class="panel command-preview">
          <div class="panel-title">
            <div><p class="eyebrow">{{ t('commandPreview') }}</p><p class="muted">{{ t('commandPreviewHint') }}</p></div>
            <button class="ghost compact" @click="commandPreviews = []">{{ t('close') }}</button>
          </div>
          <div class="command-preview-list">
            <article v-for="preview in commandPreviews" :key="preview.serial">
              <strong>{{ previewLabel(preview.serial) }}</strong>
              <code>{{ previewArgv(preview) }}</code>
              <div class="command-detail-list">
                <div v-for="(detail, index) in preview.details" :key="`${detail.arg}-${index}`">
                  <code>{{ detail.arg }}</code><span>{{ previewSource(detail) }}</span><small>{{ t(detail.helpKey) }}</small>
                </div>
              </div>
              <p v-for="warning in preview.warnings" :key="warning" class="inline-warning">{{ warning }}</p>
            </article>
          </div>
        </section>

        <section v-if="usableDevices.length" class="panel control-panel device-workspace">
          <div class="panel-title">
            <div><p class="eyebrow">{{ t('deviceWorkspace') }}</p><p class="muted">{{ t('deviceWorkspaceHint') }}</p></div>
            <select v-model="controlSerial" :disabled="!usableDevices.length">
              <option value="">{{ t('chooseDevice') }}</option>
              <option v-for="device in usableDevices" :key="device.serial" :value="device.serial">{{ config.deviceAliases[device.serial] || device.model }} · {{ device.serial }}</option>
            </select>
          </div>
          <nav class="workspace-tabs" :aria-label="t('deviceWorkspace')">
            <button v-for="section in (['overview', 'control', 'apps', 'files'] as WorkspaceSection[])" :key="section" :class="{ active: workspaceSection === section }" :disabled="!controlDevice" @click="setWorkspaceSection(section)">{{ t(`workspace_${section}`) }}</button>
          </nav>

          <div v-if="workspaceSection === 'overview'" class="workspace-pane overview-pane">
            <p v-if="loadingOverview" class="muted">{{ t('loadingDeviceDetails') }}</p>
            <template v-else-if="deviceOverview">
              <div class="overview-grid">
                <div><span>{{ t('manufacturer') }}</span><strong>{{ deviceOverview.manufacturer || '—' }}</strong></div>
                <div><span>{{ t('model') }}</span><strong>{{ deviceOverview.model || '—' }}</strong></div>
                <div><span>Android</span><strong>{{ deviceOverview.androidVersion || '—' }} <small v-if="deviceOverview.sdk">API {{ deviceOverview.sdk }}</small></strong></div>
                <div><span>{{ t('display') }}</span><strong>{{ deviceOverview.displaySize || '—' }}</strong></div>
                <div><span>ABI</span><strong>{{ deviceOverview.abi || '—' }}</strong></div>
                <div><span>{{ t('battery') }}</span><strong>{{ deviceOverview.batteryLevel === undefined ? '—' : `${deviceOverview.batteryLevel}%` }}</strong></div>
              </div>
              <button class="ghost compact" @click="loadDeviceOverview">{{ t('refreshDetails') }}</button>
            </template>
          </div>

          <div v-if="workspaceSection === 'control'" class="workspace-pane">
            <div class="control-actions">
              <button v-for="action in controlActions" :key="action" class="ghost" :disabled="!controlDevice || recordingAutomation && !!replayingAutomation" @click="sendControlAction(action)">{{ actionLabel(action) }}</button>
              <button class="secondary" :disabled="!controlDevice" @click="takeScreenshot">{{ t('screenshot') }}</button>
            </div>
            <div class="automation-bar">
              <div><strong>{{ t('automation') }}</strong><small>{{ t('automationHint') }}</small></div>
              <div class="button-row nowrap">
                <button v-if="!recordingAutomation" class="secondary compact" :disabled="!controlDevice || !!replayingAutomation" @click="startAutomationRecording">{{ t('startRecordingActions') }}</button>
                <button v-else class="danger compact recording" @click="stopAutomationRecording">{{ t('stopRecordingActions') }} · {{ recordedSteps.length }}</button>
              </div>
            </div>
            <div v-if="recordedSteps.length && !recordingAutomation" class="inline-form automation-save">
              <input v-model.trim="automationName" :placeholder="t('automationName')" />
              <button class="secondary" @click="saveAutomation">{{ t('save') }}</button>
              <button class="ghost" @click="recordedSteps = []">{{ t('discard') }}</button>
            </div>
            <div v-if="config.automations.length" class="saved-list">
              <div v-for="macro in config.automations" :key="macro.id" class="saved-row">
                <span><strong>{{ macro.name }}</strong><small>{{ macro.steps.length }} {{ t('actions') }}</small></span>
                <div class="button-row nowrap"><button class="secondary compact" :disabled="!controlDevice || !!replayingAutomation" @click="replayAutomation(macro)">{{ replayingAutomation === macro.id ? t('replaying') : t('replay') }}</button><button class="ghost compact" :disabled="!!replayingAutomation" @click="deleteAutomation(macro.id)">{{ t('delete') }}</button></div>
              </div>
            </div>
          </div>

          <div v-if="workspaceSection === 'apps'" class="workspace-pane">
            <div class="workspace-toolbar">
              <input v-model.trim="appSearch" type="search" :placeholder="t('searchApps')" />
              <label class="inline-check"><input v-model="showSystemApps" type="checkbox" /><span>{{ t('showSystemApps') }}</span></label>
              <button class="ghost" :disabled="loadingApps" @click="loadInstalledApps(true)">{{ t('refresh') }}</button>
            </div>
            <p v-if="loadingApps" class="muted">{{ t('loadingApps') }}</p>
            <div v-else-if="visibleApps.length" class="app-list">
              <div v-for="app in visibleApps" :key="app.packageId" class="app-row">
                <span><strong>{{ app.label }}</strong><code>{{ app.packageId }}</code></span>
                <span v-if="app.system" class="app-badge">{{ t('systemApp') }}</span>
                <button class="secondary compact" @click="startInstalledApp(app)">{{ t('startApp') }}</button>
              </div>
            </div>
            <p v-else class="muted">{{ t('noApps') }}</p>
          </div>

          <div v-if="workspaceSection === 'files'" class="workspace-pane">
            <p class="workspace-target-summary">{{ t('batchTargets') }}: <strong>{{ workspaceTargets.length }}</strong> · {{ t('selectedDevicesTakePriority') }}</p>
            <div class="file-actions-grid">
              <div class="file-action-card">
                <div><strong>{{ t('pushFiles') }}</strong><small>{{ t('pushFilesHint') }}</small></div>
                <label><span>{{ t('targetDirectory') }}</span><input v-model.trim="fileTarget" placeholder="/sdcard/Download/" /></label>
                <label><span>{{ t('existingFile') }}</span><select v-model="fileConflict"><option value="replace">{{ t('replace') }}</option><option value="skip">{{ t('skip') }}</option></select></label>
                <button class="secondary" :disabled="workspaceBusy || !workspaceTargets.length || !fileTarget" @click="pushSelectedFiles">{{ t('chooseAndPush') }}</button>
              </div>
              <div class="file-action-card">
                <div><strong>{{ t('installApk') }}</strong><small>{{ t('installApkHint') }}</small></div>
                <label class="toggle"><input v-model="installReplace" type="checkbox" /><span>{{ t('replaceExistingApp') }}</span></label>
                <label class="toggle warning-toggle"><input v-model="installDowngrade" type="checkbox" /><span>{{ t('allowDowngrade') }}</span></label>
                <button class="secondary" :disabled="workspaceBusy || !workspaceTargets.length" @click="installSelectedApk">{{ t('chooseAndInstall') }}</button>
              </div>
            </div>
            <div v-if="workspaceResults.length" class="batch-results">
              <div v-for="result in workspaceResults" :key="result.targetId" :class="['batch-result', result.ok ? 'ok' : 'failed']">
                <span><strong>{{ result.targetId }}</strong><small v-if="result.data">{{ formatBytes(result.data.size) }}</small></span>
                <p>{{ workspaceResultMessage(result) }}</p>
                <details v-if="result.error?.detail"><summary>{{ t('errorDetails') }}</summary><code>{{ result.error.detail }}</code></details>
              </div>
            </div>
            <div v-else-if="workspaceProgress.length" class="batch-results" aria-live="polite">
              <div v-for="progress in workspaceProgress" :key="progress.targetId" :class="['batch-result', progress.status === 'failed' ? 'failed' : 'ok']">
                <span><strong>{{ progress.targetId }}</strong><small v-if="progress.size !== undefined">{{ formatBytes(progress.size) }}</small></span>
                <p>{{ progress.status }} · {{ progress.message }}</p>
              </div>
            </div>
          </div>
        </section>

        <section class="panel wireless-panel">
          <div class="panel-title"><div><p class="eyebrow">{{ t('wireless') }}</p><p class="muted">{{ t('wirelessHint') }}</p></div></div>
          <div class="wireless-grid">
            <div class="inline-form"><input v-model.trim="wirelessTarget" :placeholder="t('address')" /><button class="secondary" :disabled="!wirelessTarget || !environment?.adb.ok" @click="connect()">{{ t('connect') }}</button></div>
            <div class="inline-form pair-form"><input v-model.trim="pairTarget" :placeholder="t('pairAddress')" /><input v-model.trim="pairingCode" inputmode="numeric" maxlength="6" :placeholder="t('pairingCode')" /><button class="secondary" :disabled="!pairTarget || pairingCode.length !== 6 || !environment?.adb.ok" @click="pair">{{ t('pair') }}</button></div>
          </div>
          <div v-if="config.wirelessTargets.length" class="saved-targets">
            <div v-for="target in config.wirelessTargets" :key="target.id" class="saved-row wireless-target">
              <input v-model.trim="target.name" :aria-label="t('savedAddressName')" />
              <code>{{ target.address }}</code>
              <label class="inline-check"><input v-model="target.autoConnect" type="checkbox" /><span>{{ t('autoConnect') }}</span></label>
              <div class="button-row nowrap"><button class="secondary compact" :disabled="!environment?.adb.ok" @click="connectSaved(target)">{{ t('connect') }}</button><button class="ghost compact" @click="forgetWirelessTarget(target.id)">{{ t('delete') }}</button></div>
            </div>
          </div>
        </section>
      </template>

      <template v-else-if="activeTab === 'sessions'">
        <section class="sessions-header">
          <div><p class="eyebrow">{{ t('sessionCenter') }}</p><h1>{{ t('sessions') }}</h1><p class="muted">{{ t('sessionsHint') }}</p></div>
          <button class="danger" :disabled="!sessions.some(sessionIsActive)" @click="stopAllSessions">{{ t('stopAllSessions') }}</button>
        </section>
        <section v-if="sessions.length" class="session-list">
          <article v-for="session in sessions" :key="session.id" class="panel session-card">
            <div class="session-summary">
              <span :class="['session-state', session.state]">{{ t(`sessionState_${session.state}`) }}</span>
              <div class="session-device"><strong>{{ sessionDeviceLabel(session) }}</strong><code>{{ session.serialAtLaunch }} · {{ session.scene }}</code></div>
              <div class="session-meta"><span>{{ new Date(session.createdAt).toLocaleString() }}</span><code v-if="session.pid">PID {{ session.pid }}</code></div>
              <button v-if="sessionIsActive(session)" class="danger compact" :disabled="session.state === 'stopping'" @click="stopSession(session.id)">{{ t('stop') }}</button>
            </div>
            <code class="session-command">{{ sessionArgv(session) }}</code>
            <p v-if="session.error" class="session-error">{{ session.error }}</p>
          </article>
        </section>
        <section v-else class="empty-state"><span class="empty-icon">◷</span><p>{{ t('noSessions') }}</p></section>
      </template>

      <template v-else-if="activeTab === 'artifacts'">
        <section class="artifacts-header">
          <div><p class="eyebrow">{{ t('artifactLibrary') }}</p><h1>{{ t('artifacts') }}</h1><p class="muted">{{ t('artifactsHint') }}</p></div>
          <div class="artifact-filters">
            <select v-model="artifactKind" :aria-label="t('filterArtifactKind')"><option value="all">{{ t('allArtifactKinds') }}</option><option v-for="kind in artifactKinds" :key="kind" :value="kind">{{ t(`artifactKind_${kind}`) }}</option></select>
            <select v-model="artifactDevice" :aria-label="t('filterArtifactDevice')"><option value="all">{{ t('allDevices') }}</option><option v-for="serial in artifactDevices" :key="serial" :value="serial">{{ config.deviceAliases[serial] || serial }}</option></select>
            <button class="ghost" :disabled="loadingArtifacts" @click="loadArtifacts">{{ t('refresh') }}</button>
          </div>
        </section>
        <section v-if="visibleArtifacts.length" class="artifact-list">
          <article v-for="artifact in visibleArtifacts" :key="artifact.id" class="panel artifact-card">
            <div class="artifact-icon">{{ artifact.kind === 'screenshot' ? '▧' : artifact.kind === 'recording' ? '▶' : artifact.kind === 'diagnostic' ? '⌁' : '⇄' }}</div>
            <div class="artifact-copy">
              <div class="artifact-title"><strong>{{ artifact.name }}</strong><span :class="['artifact-status', artifact.status]">{{ t(`artifactStatus_${artifact.status}`) }}</span></div>
              <code>{{ artifact.path }}</code>
              <small>{{ t(`artifactKind_${artifact.kind}`) }} · {{ artifactDeviceLabel(artifact) }} · {{ new Date(artifact.createdAt).toLocaleString() }} · {{ formatBytes(artifact.size) }}</small>
            </div>
            <div class="artifact-actions">
              <button class="secondary compact" :disabled="artifact.status === 'missing'" @click="openArtifact(artifact)">{{ t('open') }}</button>
              <button class="ghost compact" :disabled="artifact.status === 'missing'" @click="revealArtifact(artifact)">{{ t('reveal') }}</button>
              <button class="ghost compact" :disabled="artifact.status === 'missing'" @click="copyArtifactPath(artifact)">{{ t('copyPath') }}</button>
              <button v-if="artifact.kind === 'diagnostic'" class="secondary compact" :disabled="artifact.status === 'missing'" @click="openIssueHelper(artifact)">{{ t('reportIssue') }}</button>
              <button class="ghost compact" @click="deleteArtifact(artifact, false)">{{ t('removeIndex') }}</button>
              <button class="danger compact" :disabled="artifact.status === 'missing'" @click="deleteArtifact(artifact, true)">{{ t('deleteFile') }}</button>
            </div>
          </article>
        </section>
        <section v-else class="empty-state"><span class="empty-icon">▧</span><p>{{ loadingArtifacts ? t('loadingArtifacts') : t('noArtifacts') }}</p></section>
      </template>

      <template v-else-if="activeTab === 'settings'">
        <section class="settings-header"><div><p class="eyebrow">Scrcpy GUI</p><h1>{{ t('settings') }}</h1><p class="muted">{{ t('savedAutomatically') }}</p></div><button class="ghost" @click="resetSettings">{{ t('resetSettings') }}</button></section>
        <nav class="settings-tabs" :aria-label="t('settings')">
          <button v-for="section in settingsSections" :key="section" :class="{ active: activeSettingsSection === section }" @click="activeSettingsSection = section">{{ t(`settingsSection_${section}`) }}</button>
        </nav>
        <div class="settings-grid">
          <section v-if="activeSettingsSection === 'general'" class="panel settings-section wide profiles-section">
            <h2>{{ t('profiles') }}</h2>
            <p class="muted">{{ t('profilesHint') }}</p>
            <div class="inline-form"><input v-model.trim="profileName" :placeholder="t('profileName')" /><button class="secondary" @click="saveProfile">{{ t('saveCurrentProfile') }}</button></div>
            <div v-if="config.profiles.length" class="saved-list">
              <div v-for="profile in config.profiles" :key="profile.id" class="saved-row">
                <input v-model.trim="profile.name" :aria-label="t('profileName')" />
                <div class="profile-summary">{{ profile.launch.maxSize || t('automatic') }} px · {{ profile.launch.videoBitRate }} Mbps<span v-if="profile.launch.crop.width"> · {{ profile.launch.crop.width }}×{{ profile.launch.crop.height }}</span></div>
                <div class="button-row nowrap"><button class="ghost compact" @click="applyProfile(profile)">{{ t('load') }}</button><button class="secondary compact" @click="updateProfile(profile)">{{ t('update') }}</button><button class="ghost compact" @click="deleteProfile(profile.id)">{{ t('delete') }}</button></div>
              </div>
            </div>
          </section>
          <section v-if="activeSettingsSection === 'general'" class="panel settings-section wide">
            <h2>{{ t('general') }}</h2>
            <label><span>{{ t('windowTitle') }}</span><input v-model="config.launch.windowTitle" placeholder="Android" /></label>
            <label><span>{{ t('shortcutModifier') }}</span><select v-model="config.launch.shortcutModifier"><option value="default">System default</option><option value="lctrl">Left Ctrl</option><option value="rctrl">Right Ctrl</option><option value="lalt">Left Alt</option><option value="ralt">Right Alt</option><option value="lsuper">Left Super</option><option value="rsuper">Right Super</option></select><small>{{ t('shortcutHint') }}</small></label>
            <label><span>{{ t('keyboardMode') }}</span><select v-model="config.launch.keyboardMode"><option value="default">Default</option><option value="sdk">SDK</option><option value="uhid">UHID</option><option value="aoa">AOA</option></select></label>
            <div class="field-pair"><label><span>{{ t('mouseMode') }}</span><select v-model="config.launch.mouseMode"><option value="default">Default</option><option value="sdk">SDK</option><option value="uhid">UHID</option><option value="aoa">AOA</option><option value="disabled">Disabled</option></select></label><label><span>{{ t('gamepadMode') }}</span><select v-model="config.launch.gamepadMode"><option value="default">Disabled</option><option value="uhid">UHID</option><option value="aoa">AOA</option></select></label></div>
          </section>

          <section v-if="activeSettingsSection === 'video'" class="panel settings-section wide">
            <h2>{{ t('video') }}</h2>
            <div class="field-pair"><label><span>{{ t('bitRate') }}</span><input v-model.number="config.launch.videoBitRate" type="number" min="1" max="1024" /></label><label><span>{{ t('maxFps') }}</span><input v-model.number="config.launch.maxFps" type="number" min="0" max="1000" /></label></div>
            <div class="field-pair"><label><span>{{ t('videoBuffer') }}</span><input v-model.number="config.launch.videoBuffer" type="number" min="0" /></label><label><span>{{ t('audioBuffer') }}</span><input v-model.number="config.launch.audioBuffer" type="number" min="0" /></label></div>
            <div class="field-pair"><label><span>{{ t('maxSize') }}</span><input v-model.number="config.launch.maxSize" type="number" min="0" /></label><label><span>{{ t('orientation') }}</span><select v-model="config.launch.orientation"><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label></div>
            <label><span>{{ t('displayId') }}</span><input v-model.number="config.launch.displayId" type="number" min="0" /><small>{{ t('displayIdHint') }}</small></label>
            <label><span>{{ t('codec') }}</span><select v-model="config.launch.videoCodec"><option value="default">Default</option><option value="h264">H.264</option><option value="h265">H.265</option><option value="av1">AV1</option><option value="vp8">VP8</option><option value="vp9">VP9</option></select></label>
          </section>

          <section v-if="activeSettingsSection === 'controls'" class="panel settings-section wide">
            <h2>{{ t('behavior') }}</h2>
            <div class="toggle-grid">
              <label class="toggle"><input v-model="config.launch.alwaysOnTop" type="checkbox" /><span>{{ t('alwaysOnTop') }}</span></label>
              <label class="toggle"><input v-model="config.launch.control" type="checkbox" /><span>{{ t('control') }}</span></label>
              <label class="toggle"><input v-model="config.launch.audio" type="checkbox" /><span>{{ t('audio') }}</span></label>
              <label class="toggle"><input v-model="config.launch.turnScreenOff" type="checkbox" /><span>{{ t('turnScreenOff') }}</span></label>
              <label class="toggle"><input v-model="config.launch.stayAwake" type="checkbox" /><span>{{ t('stayAwake') }}</span></label>
              <label class="toggle"><input v-model="config.launch.showTouches" type="checkbox" /><span>{{ t('showTouches') }}</span></label>
              <label class="toggle"><input v-model="config.launch.fullscreen" type="checkbox" /><span>{{ t('fullscreen') }}</span></label>
              <label class="toggle"><input v-model="config.launch.borderless" type="checkbox" /><span>{{ t('borderless') }}</span></label>
              <label class="toggle"><input v-model="config.launch.windowAspectRatioLock" type="checkbox" /><span>{{ t('aspectRatioLock') }}</span></label>
              <label class="toggle"><input v-model="config.autoSelectFirstDevice" type="checkbox" /><span>{{ t('autoSelectFirst') }}</span></label>
            </div>
          </section>

          <section v-if="activeSettingsSection === 'recording'" class="panel settings-section wide">
            <h2>{{ t('recording') }}</h2>
            <label class="toggle"><input v-model="config.launch.recordEnabled" type="checkbox" /><span>{{ t('recordEnabled') }}</span></label>
            <label class="toggle"><input v-model="config.launch.autoRecordName" type="checkbox" :disabled="!config.launch.recordEnabled" /><span>{{ t('autoRecordName') }}</span></label>
            <label v-if="config.launch.autoRecordName"><span>{{ t('recordDirectory') }}</span><div class="input-action"><input v-model="config.launch.recordDirectory" :disabled="!config.launch.recordEnabled" /><button class="ghost compact" :disabled="!config.launch.recordEnabled" @click="chooseRecordDirectory">{{ t('chooseFolder') }}</button></div></label>
            <label v-else><span>{{ t('recordPath') }}</span><div class="input-action"><input v-model="config.launch.recordPath" :disabled="!config.launch.recordEnabled" /><button class="ghost compact" :disabled="!config.launch.recordEnabled" @click="chooseRecordPath">{{ t('chooseFile') }}</button></div></label>
            <label class="toggle"><input v-model="config.launch.noPlayback" type="checkbox" :disabled="!config.launch.recordEnabled" /><span>{{ t('noPlayback') }}</span></label>
          </section>

          <section v-if="activeSettingsSection === 'geometry'" class="panel settings-section wide">
            <h2>{{ t('geometry') }}</h2>
            <label><span>{{ t('crop') }}</span><div class="number-row"><input v-model.number="config.launch.crop.x" type="number" /><input v-model.number="config.launch.crop.y" type="number" /><input v-model.number="config.launch.crop.width" type="number" min="0" /><input v-model.number="config.launch.crop.height" type="number" min="0" /></div></label>
            <label><span>{{ t('initialWindow') }}</span><div class="number-row"><input v-model.number="config.launch.window.x" type="number" /><input v-model.number="config.launch.window.y" type="number" /><input v-model.number="config.launch.window.width" type="number" min="0" /><input v-model.number="config.launch.window.height" type="number" min="0" /></div></label>
          </section>

          <section v-if="activeSettingsSection === 'advanced'" class="panel settings-section wide">
            <h2>{{ t('advanced') }}</h2>
            <label><span>{{ t('extraArgs') }}</span><textarea v-model="config.launch.extraArgs" rows="5" placeholder="--power-off-on-close"></textarea><small>{{ t('extraArgsHint') }}</small></label>
            <div class="field-pair"><label><span>{{ t('pushTarget') }}</span><input v-model.trim="config.launch.pushTarget" placeholder="/sdcard/Download/" /><small>{{ t('pushTargetHint') }}</small></label><label><span>{{ t('tunnelPort') }}</span><input v-model.trim="config.launch.tunnelPort" placeholder="27183:27199" /><small>{{ t('tunnelPortHint') }}</small></label></div>
            <label class="toggle"><input v-model="config.muteNotifications" type="checkbox" /><span>{{ t('muteNotifications') }}</span></label>
            <label class="toggle"><input v-model="config.minimizeToTray" type="checkbox" /><span>{{ t('minimizeToTray') }}</span></label>
            <label class="toggle"><input v-model="config.killAdbOnQuit" type="checkbox" /><span>{{ t('killAdbOnQuit') }}</span></label>
            <div class="boss-key-row">
              <label class="toggle"><input v-model="config.bossKeyEnabled" type="checkbox" /><span>{{ t('bossKey') }}</span></label>
              <label><span>{{ t('bossKeyShortcut') }}</span><input v-model.trim="config.bossKeyAccelerator" :disabled="!config.bossKeyEnabled" placeholder="CommandOrControl+Shift+B" @change="applyBossKey(true)" /><small>{{ t('bossKeyHint') }}</small></label>
            </div>
          </section>
        </div>
      </template>

      <template v-else-if="activeTab === 'logs'">
        <section class="logs-header">
          <div><p class="eyebrow">{{ t('logs') }}</p><h1>{{ t('structuredEvents') }}</h1></div>
          <div class="logs-actions">
            <select v-model="logLevel" :aria-label="t('filterByLevel')"><option value="all">{{ t('allLevels') }}</option><option v-for="level in eventLevels" :key="level" :value="level">{{ level }}</option></select>
            <select v-model="logDomain" :aria-label="t('filterByDomain')"><option value="all">{{ t('allDomains') }}</option><option v-for="domain in eventDomains" :key="domain" :value="domain">{{ domain }}</option></select>
            <button class="secondary" :disabled="preparingDiagnostics" @click="previewDiagnostics">{{ t('prepareDiagnostics') }}</button>
            <button class="ghost" @click="clearLogs">{{ t('clearLogs') }}</button>
          </div>
        </section>
        <section v-if="diagnosticPreview" class="panel diagnostic-preview">
          <div class="panel-title">
            <div><p class="eyebrow">{{ t('diagnosticPreview') }}</p><p class="muted">{{ t('diagnosticPrivacyHint') }}</p></div>
            <span class="diagnostic-size">{{ formatBytes(diagnosticPreview.estimatedBytes) }} / {{ formatBytes(diagnosticPreview.maxBytes) }}</span>
          </div>
          <div class="diagnostic-grid">
            <div class="diagnostic-files">
              <strong>{{ t('includedFiles') }}</strong>
              <div v-for="file in diagnosticPreview.files" :key="file.name"><code>{{ file.name }}</code><span>{{ file.description }}</span><small>{{ formatBytes(file.bytes) }}</small></div>
            </div>
            <div class="diagnostic-redactions">
              <strong>{{ t('redactionsApplied') }}</strong>
              <div v-if="diagnosticPreview.redactions.length" class="redaction-pills"><span v-for="item in diagnosticPreview.redactions" :key="item.kind">{{ item.kind }} · {{ item.count }}</span></div>
              <p v-else class="muted">{{ t('noSensitiveValuesFound') }}</p>
              <small>{{ diagnosticPreview.eventCount }} {{ t('recentEventsIncluded') }}</small>
            </div>
          </div>
          <div class="diagnostic-actions">
            <button class="primary" :disabled="preparingDiagnostics" @click="exportDiagnostics">{{ t('exportDiagnosticBundle') }}</button>
            <button v-if="diagnosticArtifact" class="secondary" @click="openIssueHelper()">{{ t('openIssueHelper') }}</button>
            <span v-if="diagnosticArtifact" class="muted">{{ diagnosticArtifact.name }}</span>
          </div>
        </section>
        <section class="terminal">
          <p v-if="!visibleLogs.length" class="muted">{{ t('noLogs') }}</p>
          <div v-for="entry in visibleLogs" :key="entry.id" :class="['log-line', entry.level]">
            <time>{{ new Date(entry.timestamp).toLocaleTimeString() }}</time>
            <div class="log-entry">
              <code>[{{ entry.domain }}/{{ entry.action }}]<template v-if="entry.deviceId"> [{{ entry.deviceId }}]</template> {{ entry.message }}</code>
              <small v-if="entry.stage || entry.requestId" class="log-context"><template v-if="entry.stage">stage={{ entry.stage }}</template><template v-if="entry.requestId"> request={{ entry.requestId }}</template></small>
              <details v-if="eventError(entry)" class="error-details">
                <summary>{{ t('errorDetails') }} · {{ eventError(entry)?.code }}</summary>
                <p v-if="eventError(entry)?.detail">{{ eventError(entry)?.detail }}</p>
                <p>{{ t('retryable') }}: {{ eventError(entry)?.retryable ? t('yes') : t('no') }}</p>
                <ul v-if="eventError(entry)?.suggestedActions.length"><li v-for="action in eventError(entry)?.suggestedActions" :key="action">{{ action }}</li></ul>
              </details>
            </div>
          </div>
        </section>
      </template>
    </main>

    <div class="toast-stack" aria-live="polite"><div v-for="item in toasts" :key="item.id" :class="['toast', item.kind]">{{ item.message }}</div></div>
  </div>
</template>

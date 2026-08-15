<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, toRaw, watch } from 'vue'
import type {
  AutomationMacro,
  AutomationStep,
  CapabilitySnapshot,
  CommandPreview,
  Device,
  DeviceControlAction,
  EnvironmentStatus,
  LaunchConfig,
  LaunchProfile,
  PersistedConfig,
  ScrcpySession,
  ScrcpySessionEvent,
  ScrcpyStatusEvent,
  WirelessTarget
} from '../shared/types'
import { translate } from './i18n'

type Tab = 'devices' | 'sessions' | 'settings' | 'logs'
type SettingsSection = 'general' | 'video' | 'controls' | 'recording' | 'geometry' | 'advanced'
type ToastKind = 'success' | 'error' | 'info'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

const STORAGE_KEY = 'scrcpy-gui:config:v2'

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

function defaultLaunchConfig(): LaunchConfig {
  return {
    windowTitle: '', videoBitRate: 8, videoBuffer: 0, audioBuffer: 0, maxSize: 0, maxFps: 0, displayId: 0,
    orientation: '0', videoCodec: 'default',
    shortcutModifier: 'default', keyboardMode: 'default', mouseMode: 'default', gamepadMode: 'default',
    alwaysOnTop: false, control: true, audio: true,
    turnScreenOff: false, stayAwake: false, showTouches: false, fullscreen: false, borderless: false,
    windowAspectRatioLock: true,
    pushTarget: '', tunnelPort: '',
    recordEnabled: false, recordPath: '', autoRecordName: false, recordDirectory: '', noPlayback: false,
    crop: { x: 0, y: 0, width: 0, height: 0 },
    window: { x: 0, y: 0, width: 0, height: 0 },
    extraArgs: ''
  }
}

function normalizedLaunch(stored?: Partial<LaunchConfig>): LaunchConfig {
  const defaults = defaultLaunchConfig()
  return {
    ...defaults,
    ...stored,
    crop: { ...defaults.crop, ...stored?.crop },
    window: { ...defaults.window, ...stored?.window }
  }
}

function defaultConfig(): PersistedConfig {
  return {
    runtime: { scrcpyPath: '' },
    locale: detectedLocale(),
    muteNotifications: false,
    minimizeToTray: false,
    killAdbOnQuit: false,
    bossKeyEnabled: false,
    bossKeyAccelerator: 'CommandOrControl+Shift+B',
    autoSelectFirstDevice: true,
    autoLaunchDevices: {},
    launch: defaultLaunchConfig(),
    profiles: [],
    deviceProfiles: {},
    deviceAliases: {},
    wirelessTargets: [],
    automations: []
  }
}

function loadConfig(): PersistedConfig {
  const defaults = defaultConfig()
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<PersistedConfig>
    const profiles = Array.isArray(stored.profiles)
      ? stored.profiles.map((profile) => ({ ...profile, launch: normalizedLaunch(profile.launch) }))
      : []
    return {
      ...defaults,
      ...stored,
      runtime: { ...defaults.runtime, ...stored.runtime },
      launch: normalizedLaunch(stored.launch),
      profiles,
      deviceProfiles: stored.deviceProfiles || {},
      deviceAliases: stored.deviceAliases || {},
      autoLaunchDevices: stored.autoLaunchDevices || {},
      wirelessTargets: Array.isArray(stored.wirelessTargets) ? stored.wirelessTargets : [],
      automations: Array.isArray(stored.automations) ? stored.automations : []
    }
  } catch {
    return defaults
  }
}

const config = reactive(loadConfig())
const activeTab = ref<Tab>('devices')
const activeSettingsSection = ref<SettingsSection>('general')
const version = ref('2.0.0')
const environment = ref<EnvironmentStatus | null>(null)
const devices = ref<Device[]>([])
const selectedSerials = ref<string[]>([])
const commandPreviews = ref<CommandPreview[]>([])
const sessions = ref<ScrcpySession[]>([])
const activeSerials = ref(new Set<string>())
const loadingEnvironment = ref(false)
const loadingDevices = ref(false)
const wirelessTarget = ref(config.wirelessTargets[0]?.address || '')
const pairTarget = ref('')
const pairingCode = ref('')
const profileName = ref('')
const controlSerial = ref('')
const recordingAutomation = ref(false)
const recordedSteps = ref<AutomationStep[]>([])
const automationName = ref('')
const replayingAutomation = ref('')
const logs = ref<ScrcpyStatusEvent[]>([])
const toasts = ref<Toast[]>([])
let toastId = 0
let pollTimer: number | undefined
let removeStatusListener: (() => void) | undefined
let removeSessionListener: (() => void) | undefined
let lastRecordedActionAt = 0
const autoLaunchAttempted = new Set<string>()

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
const settingsSections: SettingsSection[] = ['general', 'video', 'controls', 'recording', 'geometry', 'advanced']
const capabilityFeatureKeys: Array<keyof CapabilitySnapshot['features']> = [
  'screen', 'camera', 'virtualDisplay', 'recordOnly', 'controlOnly', 'otg', 'v4l2', 'appLaunch'
]
const availableCapabilities = computed(() => {
  const features = environment.value?.scrcpy.capabilities?.features
  return features ? capabilityFeatureKeys.filter((feature) => features[feature]) : []
})

const runtimeSnapshot = () => ({ scrcpyPath: config.runtime.scrcpyPath })
const launchSnapshot = (serial?: string): LaunchConfig => {
  const profileId = serial ? config.deviceProfiles[serial] : ''
  const profile = profileId ? config.profiles.find((item) => item.id === profileId) : undefined
  const launch = structuredClone(toRaw(profile?.launch || config.launch))
  const alias = serial ? config.deviceAliases[serial]?.trim() : ''
  if (alias && !launch.windowTitle.trim()) launch.windowTitle = alias
  return launch
}

watch(
  config,
  (value) => localStorage.setItem(STORAGE_KEY, JSON.stringify(value)),
  { deep: true }
)

watch(
  [selectedSerials, () => config.launch, () => config.profiles, () => config.deviceProfiles, () => config.deviceAliases],
  () => { commandPreviews.value = [] },
  { deep: true }
)

watch(
  () => config.minimizeToTray,
  (enabled) => void window.scrcpy.setMinimizeToTray(enabled)
)

watch(
  [() => config.killAdbOnQuit, () => config.runtime.scrcpyPath],
  () => void window.scrcpy.setQuitBehavior(runtimeSnapshot(), config.killAdbOnQuit)
)

watch(
  () => config.bossKeyEnabled,
  () => void applyBossKey(true)
)

watch(usableDevices, (nextDevices) => {
  if (!nextDevices.some((device) => device.serial === controlSerial.value)) {
    controlSerial.value = nextDevices[0]?.serial || ''
  }
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
}

async function refreshDevices(notifyError = false): Promise<void> {
  if (loadingDevices.value) return
  loadingDevices.value = true
  const result = await window.scrcpy.listDevices(runtimeSnapshot())
  loadingDevices.value = false
  if (!result.ok) {
    devices.value = []
    if (notifyError && result.error) toast('error', result.error)
    return
  }
  devices.value = result.data || []
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
      if (!startResult.ok) toast('error', startResult.error || t('operationFailed'))
    }
  }
}

function toggleSelectAll(): void {
  selectedSerials.value = allSelected.value ? [] : usableDevices.value.map((device) => device.serial)
}

async function launchSelected(): Promise<void> {
  const launches = selectedSerials.value.map((serial) => ({ serial, launch: launchSnapshot(serial) }))
  const result = await window.scrcpy.start(runtimeSnapshot(), launches)
  if (!result.ok) toast('error', result.error || t('operationFailed'))
}

async function previewSelected(): Promise<void> {
  const launches = selectedSerials.value.map((serial) => ({ serial, launch: launchSnapshot(serial) }))
  const result = await window.scrcpy.preview(launches)
  if (!result.ok) {
    toast('error', result.error || t('commandPreviewFailed'))
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

async function stop(serial: string): Promise<void> {
  const result = await window.scrcpy.stop(serial)
  if (!result.ok) toast('error', result.error || t('operationFailed'))
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
    if (notify) toast('error', result.error || t('operationFailed'))
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
    toast('error', result.error || t('operationFailed'))
    return
  }
  pairingCode.value = ''
  toast('success', t('paired'))
}

async function disconnect(serial: string): Promise<void> {
  const result = await window.scrcpy.disconnect(runtimeSnapshot(), serial)
  if (!result.ok) {
    toast('error', result.error || t('operationFailed'))
    return
  }
  toast('success', t('disconnected'))
  await refreshDevices()
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
    toast('error', result.error || t('operationFailed'))
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
    if (result.error !== 'Screenshot canceled.') toast('error', result.error || t('operationFailed'))
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
  if (!result.ok) toast('error', result.error || t('operationFailed'))
  else toast('success', t('automationComplete'))
}

function deleteAutomation(id: string): void {
  const index = config.automations.findIndex((macro) => macro.id === id)
  if (index >= 0) config.automations.splice(index, 1)
}

async function applyBossKey(notify = false): Promise<void> {
  const result = await window.scrcpy.setBossKey(config.bossKeyEnabled, config.bossKeyAccelerator)
  if (notify && !result.ok) toast('error', result.error || t('operationFailed'))
}

function resetSettings(): void {
  const defaults = defaultConfig()
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
  logs.value.push(event)
  if (logs.value.length > 500) logs.value.shift()
  if (event.status === 'running') toast('success', `${event.serial}: ${t('launched')}`)
  if (event.status === 'stopped') toast('info', `${event.serial}: ${t('stopped')}`)
  if (event.status === 'error') toast('error', `${event.serial}: ${event.message}`)
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
  if (!result.ok) toast('error', result.error || t('operationFailed'))
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
  version.value = await window.scrcpy.getVersion()
  removeStatusListener = window.scrcpy.onStatus(handleStatus)
  removeSessionListener = window.scrcpy.onSession(handleSession)
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
  pollTimer = window.setInterval(refreshDevices, 3000)
})

onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer)
  removeStatusListener?.()
  removeSessionListener?.()
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
        <button v-for="tab in (['devices', 'sessions', 'settings', 'logs'] as Tab[])" :key="tab" :class="{ active: activeTab === tab }" @click="activeTab = tab">
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
          <div><p class="eyebrow">{{ t('connectedDevices') }}</p><h1>{{ devices.length }} {{ t('devices').toLowerCase() }}</h1></div>
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
            </article>
          </div>
        </section>

        <section v-if="usableDevices.length" class="panel control-panel">
          <div class="panel-title">
            <div><p class="eyebrow">{{ t('controlPanel') }}</p><p class="muted">{{ t('controlPanelHint') }}</p></div>
            <select v-model="controlSerial" :disabled="!usableDevices.length">
              <option value="">{{ t('chooseDevice') }}</option>
              <option v-for="device in usableDevices" :key="device.serial" :value="device.serial">{{ config.deviceAliases[device.serial] || device.model }} · {{ device.serial }}</option>
            </select>
          </div>
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
            <label><span>{{ t('extraArgs') }}</span><textarea v-model="config.launch.extraArgs" rows="5" placeholder="--video-buffer=50\n--power-off-on-close"></textarea><small>{{ t('extraArgsHint') }}</small></label>
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
        <section class="logs-header"><div><p class="eyebrow">{{ t('logs') }}</p><h1>scrcpy stdout / stderr</h1></div><button class="ghost" @click="logs = []">{{ t('clearLogs') }}</button></section>
        <section class="terminal"><p v-if="!logs.length" class="muted">{{ t('noLogs') }}</p><div v-for="(entry, index) in logs" :key="`${entry.timestamp}-${index}`" :class="['log-line', entry.status]"><time>{{ new Date(entry.timestamp).toLocaleTimeString() }}</time><code>[{{ entry.serial }}] {{ entry.message }}</code></div></section>
      </template>
    </main>

    <div class="toast-stack" aria-live="polite"><div v-for="item in toasts" :key="item.id" :class="['toast', item.kind]">{{ item.message }}</div></div>
  </div>
</template>

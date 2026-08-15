<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, toRaw, watch } from 'vue'
import type {
  Device,
  EnvironmentStatus,
  PersistedConfig,
  ScrcpyStatusEvent
} from '../shared/types'
import { translate } from './i18n'

type Tab = 'devices' | 'settings' | 'logs'
type ToastKind = 'success' | 'error' | 'info'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

const STORAGE_KEY = 'scrcpy-gui:config:v2'

function detectedLocale(): PersistedConfig['locale'] {
  const locale = navigator.language.toLowerCase()
  if (locale.includes('zh-tw') || locale.includes('zh-hk')) return 'zh-TW'
  if (locale.startsWith('ru')) return 'ru'
  return locale.startsWith('zh') ? 'zh-CN' : 'en'
}

function defaultConfig(): PersistedConfig {
  return {
    runtime: { scrcpyPath: '' },
    locale: detectedLocale(),
    muteNotifications: false,
    minimizeToTray: false,
    launch: {
      windowTitle: '',
      videoBitRate: 8,
      maxSize: 0,
      maxFps: 0,
      orientation: '0',
      videoCodec: 'default',
      shortcutModifier: 'default',
      keyboardMode: 'default',
      alwaysOnTop: false,
      control: true,
      audio: true,
      turnScreenOff: false,
      stayAwake: false,
      showTouches: false,
      fullscreen: false,
      borderless: false,
      recordEnabled: false,
      recordPath: '',
      noPlayback: false,
      crop: { x: 0, y: 0, width: 0, height: 0 },
      window: { x: 0, y: 0, width: 0, height: 0 },
      extraArgs: ''
    }
  }
}

function loadConfig(): PersistedConfig {
  const defaults = defaultConfig()
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<PersistedConfig>
    return {
      ...defaults,
      ...stored,
      runtime: { ...defaults.runtime, ...stored.runtime },
      launch: {
        ...defaults.launch,
        ...stored.launch,
        crop: { ...defaults.launch.crop, ...stored.launch?.crop },
        window: { ...defaults.launch.window, ...stored.launch?.window }
      }
    }
  } catch {
    return defaults
  }
}

const config = reactive(loadConfig())
const activeTab = ref<Tab>('devices')
const version = ref('2.0.0')
const environment = ref<EnvironmentStatus | null>(null)
const devices = ref<Device[]>([])
const selectedSerials = ref<string[]>([])
const runningSerials = ref(new Set<string>())
const loadingEnvironment = ref(false)
const loadingDevices = ref(false)
const wirelessTarget = ref('')
const pairTarget = ref('')
const pairingCode = ref('')
const logs = ref<ScrcpyStatusEvent[]>([])
const toasts = ref<Toast[]>([])
let toastId = 0
let pollTimer: number | undefined
let removeStatusListener: (() => void) | undefined

const t = (key: string): string => translate(config.locale, key)
const usableDevices = computed(() => devices.value.filter((device) => device.state === 'device'))
const allSelected = computed(() =>
  usableDevices.value.length > 0 && usableDevices.value.every((device) => selectedSerials.value.includes(device.serial))
)

const runtimeSnapshot = () => ({ scrcpyPath: config.runtime.scrcpyPath })
const launchSnapshot = () => structuredClone(toRaw(config.launch))

watch(
  config,
  (value) => localStorage.setItem(STORAGE_KEY, JSON.stringify(value)),
  { deep: true }
)

watch(
  () => config.minimizeToTray,
  (enabled) => void window.scrcpy.setMinimizeToTray(enabled)
)

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
}

function toggleSelectAll(): void {
  selectedSerials.value = allSelected.value ? [] : usableDevices.value.map((device) => device.serial)
}

async function launchSelected(): Promise<void> {
  const result = await window.scrcpy.start(runtimeSnapshot(), launchSnapshot(), [...selectedSerials.value])
  if (!result.ok) toast('error', result.error || t('operationFailed'))
}

async function stop(serial: string): Promise<void> {
  const result = await window.scrcpy.stop(serial)
  if (!result.ok) toast('error', result.error || t('operationFailed'))
}

async function connect(): Promise<void> {
  const result = await window.scrcpy.connect(runtimeSnapshot(), wirelessTarget.value)
  if (!result.ok) {
    toast('error', result.error || t('operationFailed'))
    return
  }
  toast('success', t('connected'))
  await refreshDevices()
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

function resetSettings(): void {
  const defaults = defaultConfig()
  Object.assign(config.launch, defaults.launch)
  config.muteNotifications = defaults.muteNotifications
  config.minimizeToTray = defaults.minimizeToTray
}

function openGithub(): void {
  void window.scrcpy.openExternal('https://github.com/SimonAKing/scrcpy-gui')
}

function handleStatus(event: ScrcpyStatusEvent): void {
  logs.value.push(event)
  if (logs.value.length > 500) logs.value.shift()
  const next = new Set(runningSerials.value)
  if (event.status === 'starting' || event.status === 'running') next.add(event.serial)
  if (event.status === 'stopped' || event.status === 'error') next.delete(event.serial)
  runningSerials.value = next
  if (event.status === 'running') toast('success', `${event.serial}: ${t('launched')}`)
  if (event.status === 'stopped') toast('info', `${event.serial}: ${t('stopped')}`)
  if (event.status === 'error') toast('error', `${event.serial}: ${event.message}`)
}

function statusLabel(device: Device): string {
  if (runningSerials.value.has(device.serial)) return t('running')
  if (device.state === 'device') return device.connection === 'usb' ? t('usb') : t('wireless')
  if (device.state === 'offline') return t('offline')
  return device.state
}

onMounted(async () => {
  version.value = await window.scrcpy.getVersion()
  removeStatusListener = window.scrcpy.onStatus(handleStatus)
  await window.scrcpy.setMinimizeToTray(config.minimizeToTray)
  await refreshEnvironment()
  await refreshDevices()
  pollTimer = window.setInterval(refreshDevices, 3000)
})

onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer)
  removeStatusListener?.()
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
        <button v-for="tab in (['devices', 'settings', 'logs'] as Tab[])" :key="tab" :class="{ active: activeTab === tab }" @click="activeTab = tab">
          {{ t(tab) }}
          <span v-if="tab === 'logs' && logs.length" class="count">{{ logs.length }}</span>
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
      <section class="runtime-card">
        <div>
          <p class="eyebrow">{{ t('runtimeSetup') }}</p>
          <p class="muted">{{ t('runtimeHint') }}</p>
        </div>
        <div class="runtime-statuses">
          <span :class="['status-pill', environment?.scrcpy.ok ? 'ok' : 'bad']">
            scrcpy · {{ environment?.scrcpy.ok ? environment.scrcpy.version : t('notFound') }}
          </span>
          <span :class="['status-pill', environment?.adb.ok ? 'ok' : 'bad']">
            adb · {{ environment?.adb.ok ? environment.adb.version : t('notFound') }}
          </span>
        </div>
        <div class="button-row nowrap">
          <button class="secondary" @click="chooseScrcpy">{{ t('chooseScrcpy') }}</button>
          <button class="ghost" :disabled="loadingEnvironment" @click="refreshEnvironment(true)">{{ t('recheck') }}</button>
        </div>
      </section>

      <template v-if="activeTab === 'devices'">
        <section class="section-heading">
          <div><p class="eyebrow">{{ t('connectedDevices') }}</p><h1>{{ devices.length }} {{ t('devices').toLowerCase() }}</h1></div>
          <div class="button-row">
            <button class="ghost" :disabled="loadingDevices" @click="refreshDevices(true)">{{ t('refresh') }}</button>
            <button class="ghost" :disabled="!usableDevices.length" @click="toggleSelectAll">{{ t('selectAll') }}</button>
            <button class="primary" :disabled="!selectedSerials.length || !environment?.scrcpy.ok" @click="launchSelected">{{ t('launchSelected') }}</button>
          </div>
        </section>

        <section v-if="devices.length" class="device-grid">
          <article v-for="device in devices" :key="device.serial" :class="['device-card', { selected: selectedSerials.includes(device.serial) }]">
            <label class="device-select">
              <input v-model="selectedSerials" type="checkbox" :value="device.serial" :disabled="device.state !== 'device'" />
              <span class="phone-icon">▯</span>
              <span class="device-copy"><strong>{{ device.model }}</strong><code>{{ device.serial }}</code></span>
            </label>
            <div class="device-footer">
              <span :class="['status-dot', device.state, { running: runningSerials.has(device.serial) }]">{{ statusLabel(device) }}</span>
              <div class="button-row nowrap">
                <button v-if="runningSerials.has(device.serial)" class="danger compact" @click="stop(device.serial)">{{ t('stop') }}</button>
                <button v-if="device.connection === 'wireless'" class="ghost compact" @click="disconnect(device.serial)">{{ t('disconnect') }}</button>
              </div>
            </div>
            <p v-if="device.state === 'unauthorized'" class="inline-warning">{{ t('unauthorized') }}</p>
          </article>
        </section>
        <section v-else class="empty-state"><span class="empty-icon">⌁</span><p>{{ t('noDevices') }}</p></section>

        <section class="panel wireless-panel">
          <div class="panel-title"><div><p class="eyebrow">{{ t('wireless') }}</p><p class="muted">{{ t('wirelessHint') }}</p></div></div>
          <div class="wireless-grid">
            <div class="inline-form"><input v-model.trim="wirelessTarget" :placeholder="t('address')" /><button class="secondary" :disabled="!wirelessTarget || !environment?.adb.ok" @click="connect">{{ t('connect') }}</button></div>
            <div class="inline-form pair-form"><input v-model.trim="pairTarget" :placeholder="t('pairAddress')" /><input v-model.trim="pairingCode" inputmode="numeric" maxlength="6" :placeholder="t('pairingCode')" /><button class="secondary" :disabled="!pairTarget || pairingCode.length !== 6 || !environment?.adb.ok" @click="pair">{{ t('pair') }}</button></div>
          </div>
        </section>
      </template>

      <template v-else-if="activeTab === 'settings'">
        <section class="settings-header"><div><p class="eyebrow">{{ t('settings') }}</p><h1>scrcpy 4.x</h1><p class="muted">{{ t('savedAutomatically') }}</p></div><button class="ghost" @click="resetSettings">{{ t('resetSettings') }}</button></section>
        <div class="settings-grid">
          <section class="panel settings-section">
            <h2>{{ t('general') }}</h2>
            <label><span>{{ t('windowTitle') }}</span><input v-model="config.launch.windowTitle" placeholder="Android" /></label>
            <label><span>{{ t('shortcutModifier') }}</span><select v-model="config.launch.shortcutModifier"><option value="default">System default</option><option value="lctrl">Left Ctrl</option><option value="rctrl">Right Ctrl</option><option value="lalt">Left Alt</option><option value="ralt">Right Alt</option><option value="lsuper">Left Super</option><option value="rsuper">Right Super</option></select><small>{{ t('shortcutHint') }}</small></label>
            <label><span>{{ t('keyboardMode') }}</span><select v-model="config.launch.keyboardMode"><option value="default">Default</option><option value="sdk">SDK</option><option value="uhid">UHID</option><option value="aoa">AOA</option></select></label>
          </section>

          <section class="panel settings-section">
            <h2>{{ t('video') }}</h2>
            <div class="field-pair"><label><span>{{ t('bitRate') }}</span><input v-model.number="config.launch.videoBitRate" type="number" min="1" max="1024" /></label><label><span>{{ t('maxFps') }}</span><input v-model.number="config.launch.maxFps" type="number" min="0" max="1000" /></label></div>
            <div class="field-pair"><label><span>{{ t('maxSize') }}</span><input v-model.number="config.launch.maxSize" type="number" min="0" /></label><label><span>{{ t('orientation') }}</span><select v-model="config.launch.orientation"><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label></div>
            <label><span>{{ t('codec') }}</span><select v-model="config.launch.videoCodec"><option value="default">Default</option><option value="h264">H.264</option><option value="h265">H.265</option><option value="av1">AV1</option><option value="vp8">VP8</option><option value="vp9">VP9</option></select></label>
          </section>

          <section class="panel settings-section wide">
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
            </div>
          </section>

          <section class="panel settings-section">
            <h2>{{ t('recording') }}</h2>
            <label class="toggle"><input v-model="config.launch.recordEnabled" type="checkbox" /><span>{{ t('recordEnabled') }}</span></label>
            <label><span>{{ t('recordPath') }}</span><div class="input-action"><input v-model="config.launch.recordPath" :disabled="!config.launch.recordEnabled" /><button class="ghost compact" :disabled="!config.launch.recordEnabled" @click="chooseRecordPath">{{ t('chooseFile') }}</button></div></label>
            <label class="toggle"><input v-model="config.launch.noPlayback" type="checkbox" :disabled="!config.launch.recordEnabled" /><span>{{ t('noPlayback') }}</span></label>
          </section>

          <section class="panel settings-section">
            <h2>{{ t('geometry') }}</h2>
            <label><span>{{ t('crop') }}</span><div class="number-row"><input v-model.number="config.launch.crop.x" type="number" /><input v-model.number="config.launch.crop.y" type="number" /><input v-model.number="config.launch.crop.width" type="number" min="0" /><input v-model.number="config.launch.crop.height" type="number" min="0" /></div></label>
            <label><span>{{ t('initialWindow') }}</span><div class="number-row"><input v-model.number="config.launch.window.x" type="number" /><input v-model.number="config.launch.window.y" type="number" /><input v-model.number="config.launch.window.width" type="number" min="0" /><input v-model.number="config.launch.window.height" type="number" min="0" /></div></label>
          </section>

          <section class="panel settings-section wide">
            <h2>{{ t('advanced') }}</h2>
            <label><span>{{ t('extraArgs') }}</span><textarea v-model="config.launch.extraArgs" rows="5" placeholder="--video-buffer=50\n--power-off-on-close"></textarea><small>{{ t('extraArgsHint') }}</small></label>
            <label class="toggle"><input v-model="config.muteNotifications" type="checkbox" /><span>{{ t('muteNotifications') }}</span></label>
            <label class="toggle"><input v-model="config.minimizeToTray" type="checkbox" /><span>{{ t('minimizeToTray') }}</span></label>
          </section>
        </div>
      </template>

      <template v-else>
        <section class="logs-header"><div><p class="eyebrow">{{ t('logs') }}</p><h1>scrcpy stdout / stderr</h1></div><button class="ghost" @click="logs = []">{{ t('clearLogs') }}</button></section>
        <section class="terminal"><p v-if="!logs.length" class="muted">{{ t('noLogs') }}</p><div v-for="(entry, index) in logs" :key="`${entry.timestamp}-${index}`" :class="['log-line', entry.status]"><time>{{ new Date(entry.timestamp).toLocaleTimeString() }}</time><code>[{{ entry.serial }}] {{ entry.message }}</code></div></section>
      </template>
    </main>

    <div class="toast-stack" aria-live="polite"><div v-for="item in toasts" :key="item.id" :class="['toast', item.kind]">{{ item.message }}</div></div>
  </div>
</template>

import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, session, shell, Tray } from 'electron'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import type {
  AutomationStep,
  BatchProgressEvent,
  DeviceControlAction,
  DeviceLaunch,
  FileConflictPolicy,
  Locale,
  OperationResult,
  PersistedConfig,
  RuntimeConfig,
  ScrcpySessionEvent,
  ScrcpyStatusEvent
} from '../shared/types'
import {
  captureDeviceScreenshot,
  connectDevice,
  controlDevice,
  disconnectDevice,
  getEnvironment,
  listDevices,
  listScrcpySessions,
  listTrackedDevices,
  pairDevice,
  runDeviceAutomation,
  startScrcpy,
  startDeviceTracker,
  stopAdbServer,
  stopAllScrcpy,
  stopScrcpy,
  stopScrcpySession,
  stopDeviceTracker,
  subscribeDeviceTrackerEvents,
  subscribeScrcpySessionEvents,
  setDeviceTrackerVisibility
} from './processes'
import {
  automationSteps,
  boundedString,
  commandPreviewRequests,
  controlAction,
  deviceLaunches,
  deviceSerial,
  deviceSerials,
  nonNegativeInteger,
  runtimeConfig,
  strictBoolean
} from './ipcValidation'
import { isTrustedRendererUrl, PRODUCTION_CSP } from './security'
import { buildScrcpyArgDetails, prepareLaunchConfig } from './scrcpy'
import { ConfigRepository } from './configRepository'
import { EventStore, validateEventQuery } from './eventStore'
import { failureFromUnknown, operationFailure } from '../shared/errors'
import { deviceWorkspaceService, validatePackageId, validateRemoteDirectory, type SelectedLocalFile } from './deviceWorkspaceService'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let minimizeToTray = false
let isQuitting = false
let registeredBossKey = ''
let killAdbOnQuit = false
let quitRuntime: RuntimeConfig = { scrcpyPath: '' }
let shutdownStarted = false
let configRepository: ConfigRepository | undefined
const eventStore = new EventStore()
const rendererEntryUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).toString()

function rendererUrlIsTrusted(url: string): boolean {
  return isTrustedRendererUrl(url, rendererEntryUrl, process.env.ELECTRON_RENDERER_URL)
}

function assertTrustedIpcSender(event: Electron.IpcMainInvokeEvent): void {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame ||
    !rendererUrlIsTrusted(event.senderFrame.url)
  ) {
    throw new Error('Rejected IPC request from an untrusted renderer.')
  }
}

function domainForChannel(channel: string): 'runtime' | 'device' | 'session' | 'config' | 'automation' | 'artifact' {
  if (channel.includes('automation')) return 'automation'
  if (channel.includes('screenshot') || channel.startsWith('dialog:record')) return 'artifact'
  if (channel.startsWith('device:')) return 'device'
  if (channel.startsWith('session:') || channel.startsWith('scrcpy:')) return 'session'
  if (channel.startsWith('config:')) return 'config'
  return 'runtime'
}

function isOperationResult(value: unknown): value is OperationResult<unknown> {
  return Boolean(value && typeof value === 'object' && 'ok' in value && typeof value.ok === 'boolean')
}

const handle: typeof ipcMain.handle = (channel, listener) => {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedIpcSender(event)
    const requestId = randomUUID()
    const audit = !channel.startsWith('events:')
    try {
      const result = await listener(event, ...args)
      const operation = isOperationResult(result) ? result : undefined
      const failed = operation?.ok === false
      if (audit) eventStore.publish({
        level: failed ? 'warn' : 'debug', domain: domainForChannel(channel), action: channel,
        requestId,
        stage: operation?.error?.stage || 'ipc',
        message: operation?.error?.message || `${channel} completed.`,
        data: operation?.error ? { error: operation.error } : undefined
      })
      return operation ? { ...operation, requestId } : result
    } catch (error) {
      if (audit) eventStore.publish({
        level: 'error', domain: domainForChannel(channel), action: channel,
        requestId, stage: 'ipc', message: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  })
}

function configureSessionSecurity(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  if (!app.isPackaged) return
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['file://*/*'] }, (details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [PRODUCTION_CSP]
      }
    })
  })
}

function sendStatus(status: ScrcpyStatusEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scrcpy:status', status)
}

function sendSessionEvent(event: ScrcpySessionEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('session:event', event)
  const status: ScrcpyStatusEvent['status'] =
    event.type === 'output' ? 'log'
      : event.session.state === 'launching' ? 'starting'
      : event.session.state === 'running' ? 'running'
        : event.session.state === 'stopped' ? 'stopped'
          : event.session.state === 'failed' ? 'error'
            : 'log'
  sendStatus({
    serial: event.session.serialAtLaunch,
    status,
    message: event.message,
    timestamp: event.timestamp
  })
  eventStore.publish({
    level: event.type === 'output' ? 'debug' : event.session.state === 'failed' ? 'error' : 'info',
    domain: 'session', action: event.type === 'output' ? 'output' : event.session.state,
    deviceId: event.session.serialAtLaunch, sessionId: event.session.id, stage: event.session.state,
    message: event.message, data: { scene: event.session.scene, pid: event.session.pid, exitCode: event.session.exitCode }
  })
}

subscribeScrcpySessionEvents(sendSessionEvent)

subscribeDeviceTrackerEvents((event) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('device:event', event)
  eventStore.publish({
    level: event.status === 'error' ? 'error' : event.status === 'restarting' ? 'warn' : event.status === 'tracking' ? 'debug' : 'info',
    domain: 'device', action: `tracker-${event.status}`, stage: event.source, message: event.message,
    data: { revision: event.revision, added: event.added.length, changed: event.changed.length, removed: event.removed.length, retryInMs: event.retryInMs }
  })
})

eventStore.subscribe((event) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:event', event)
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 880,
    minHeight: 640,
    title: 'Scrcpy GUI',
    show: false,
    backgroundColor: '#0b1020',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.setMenuBarVisibility(false)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!rendererUrlIsTrusted(url)) event.preventDefault()
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', (event) => {
    if (minimizeToTray && !isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icons/tray.png')
    : join(app.getAppPath(), 'build/icons/16x16.png')
  const icon = nativeImage.createFromPath(iconPath)
  tray = new Tray(process.platform === 'darwin' ? icon.resize({ width: 16, height: 16 }) : icon)
  tray.setToolTip('Scrcpy GUI')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Scrcpy GUI', click: () => mainWindow?.show() },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', () => mainWindow?.show())
}

function setBossKey(enabled: boolean, accelerator: string): OperationResult<string> {
  if (registeredBossKey) {
    globalShortcut.unregister(registeredBossKey)
    registeredBossKey = ''
  }
  if (!enabled) return { ok: true, data: 'Boss key disabled.' }

  const shortcut = accelerator.trim()
  if (!shortcut) return operationFailure('BOSS_KEY_REQUIRED', 'validation', 'Enter a boss key shortcut.')
  try {
    const registered = globalShortcut.register(shortcut, () => {
      stopAllScrcpy('boss-key')
      mainWindow?.hide()
    })
    if (!registered) return operationFailure('BOSS_KEY_UNAVAILABLE', 'boss-key', `The shortcut ${shortcut} is already in use.`)
    registeredBossKey = shortcut
    return { ok: true, data: shortcut }
  } catch (error) {
    return failureFromUnknown(error, 'BOSS_KEY_REGISTRATION_FAILED', 'boss-key', 'Unable to register the boss key.')
  }
}

function sendBatchProgress(progress: BatchProgressEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('batch:progress', progress)
  eventStore.publish({
    level: progress.status === 'failed' ? 'error' : progress.status === 'running' ? 'debug' : 'info',
    domain: 'artifact',
    action: progress.kind,
    deviceId: progress.deviceId,
    stage: progress.status,
    message: progress.message,
    data: { batchId: progress.batchId, targetId: progress.targetId, size: progress.size }
  })
}

async function selectedFiles(paths: string[], extensions?: Set<string>): Promise<SelectedLocalFile[]> {
  if (paths.length < 1 || paths.length > 50) throw new TypeError('Select 1 to 50 files.')
  return Promise.all(paths.map(async (path) => {
    const info = await stat(path)
    const name = basename(path)
    if (!info.isFile()) throw new TypeError(`${name} is not a regular file.`)
    if (extensions && !extensions.has(extname(name).toLowerCase())) throw new TypeError(`${name} is not a supported package file.`)
    return { path, name, size: info.size }
  }))
}

function availableDeviceSerial(value: unknown): string {
  return availableDeviceSerials([value])[0]
}

function availableDeviceSerials(value: unknown): string[] {
  const serials = deviceSerials(value)
  const available = new Set(listTrackedDevices().filter((device) => device.state === 'device').map((device) => device.serial))
  const missing = serials.filter((serial) => !available.has(serial))
  if (missing.length) throw new TypeError(`Device is no longer available: ${missing.join(', ')}.`)
  return serials
}

handle('app:version', () => app.getVersion())
handle('events:list', (_event, query: unknown) => eventStore.list(validateEventQuery(query)))
handle('events:clear', () => eventStore.clear())
handle('app:minimize-to-tray', (_event, enabled: boolean) => {
  minimizeToTray = strictBoolean(enabled, 'minimizeToTray')
})
handle('app:quit-behavior', (_event, runtime: RuntimeConfig, shouldKillAdb: boolean) => {
  quitRuntime = runtimeConfig(runtime)
  killAdbOnQuit = strictBoolean(shouldKillAdb, 'killAdbOnQuit')
})
handle('app:boss-key', (_event, enabled: boolean, accelerator: string) =>
  setBossKey(strictBoolean(enabled, 'bossKeyEnabled'), boundedString(accelerator, 'bossKeyAccelerator', 128, true))
)
handle('dialog:scrcpy', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose the scrcpy executable',
    properties: ['openFile'],
    filters: process.platform === 'win32' ? [{ name: 'scrcpy', extensions: ['exe'] }] : []
  })
  return result.canceled ? '' : result.filePaths[0] || ''
})
handle('dialog:record', async () => {
  const result = await dialog.showSaveDialog({
    title: 'Choose recording destination',
    defaultPath: `scrcpy-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.mp4`,
    filters: [
      { name: 'MP4 video', extensions: ['mp4'] },
      { name: 'Matroska video', extensions: ['mkv'] }
    ]
  })
  return result.canceled ? '' : result.filePath || ''
})
handle('dialog:record-directory', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose recording folder',
    defaultPath: app.getPath('videos'),
    properties: ['openDirectory', 'createDirectory']
  })
  return result.canceled ? '' : result.filePaths[0] || ''
})
handle('config:load', (_event, legacyJson: string, requestedLocale: Locale) => {
  const legacy = boundedString(legacyJson, 'legacy config', 2 * 1024 * 1024, true)
  if (!['en', 'zh-CN', 'zh-TW', 'ru'].includes(requestedLocale)) throw new TypeError('locale is not supported.')
  if (!configRepository) throw new Error('Configuration repository is not ready.')
  return configRepository.load(legacy, requestedLocale)
})
handle('config:save', (_event, revision: number, config: PersistedConfig) => {
  if (!configRepository) throw new Error('Configuration repository is not ready.')
  return configRepository.save(nonNegativeInteger(revision, 'config revision'), config)
})
handle('system:environment', (_event, runtime: RuntimeConfig) => getEnvironment(runtimeConfig(runtime)))
handle('device:list', (_event, runtime: RuntimeConfig) => listDevices(runtimeConfig(runtime)))
handle('device:track', (_event, runtime: RuntimeConfig) => startDeviceTracker(runtimeConfig(runtime)))
handle('device:visibility', (_event, visible: boolean) => setDeviceTrackerVisibility(strictBoolean(visible, 'window visibility')))
handle('device:connect', (_event, runtime: RuntimeConfig, target: string) =>
  connectDevice(runtimeConfig(runtime), boundedString(target, 'wireless target', 512))
)
handle('device:pair', (_event, runtime: RuntimeConfig, target: string, code: string) =>
  pairDevice(
    runtimeConfig(runtime),
    boundedString(target, 'pairing target', 512),
    boundedString(code, 'pairing code', 6)
  )
)
handle('device:disconnect', (_event, runtime: RuntimeConfig, target: string) =>
  disconnectDevice(runtimeConfig(runtime), boundedString(target, 'wireless target', 512))
)
handle(
  'scrcpy:start',
  (_event, runtime: RuntimeConfig, launches: DeviceLaunch[]) =>
    startScrcpy(runtimeConfig(runtime), deviceLaunches(launches))
)
handle('scrcpy:preview', (_event, launches: unknown) => {
  try {
    return {
      ok: true,
      data: commandPreviewRequests(launches).map((request) => {
        const prepared = prepareLaunchConfig(request.launch, request.serial)
        return {
          serial: request.serial,
          ...buildScrcpyArgDetails(prepared, request.serial, request.source, request.profileName, request.deviceWindowTitleOverride)
        }
      })
    }
  } catch (error) {
    return failureFromUnknown(error, 'COMMAND_PREVIEW_FAILED', 'command-preview', 'Unable to build the command preview.')
  }
})
handle('session:list', () => listScrcpySessions())
handle('session:stop', (_event, id: string) => stopScrcpySession(boundedString(id, 'session id', 128)))
handle('scrcpy:stop', (_event, serial: string) => stopScrcpy(deviceSerial(serial)))
handle(
  'device:control',
  (_event, runtime: RuntimeConfig, serial: string, action: DeviceControlAction) =>
    controlDevice(runtimeConfig(runtime), deviceSerial(serial), controlAction(action))
)
handle('device:screenshot', async (_event, runtime: RuntimeConfig, serial: string) => {
  const validatedRuntime = runtimeConfig(runtime)
  const validatedSerial = deviceSerial(serial)
  const safeSerial = validatedSerial.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'device'
  const timestamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19)
  const result = await dialog.showSaveDialog({
    title: 'Save device screenshot',
    defaultPath: join(app.getPath('pictures'), `scrcpy-${safeSerial}-${timestamp}.png`),
    filters: [{ name: 'PNG image', extensions: ['png'] }]
  })
  if (result.canceled || !result.filePath) {
    return operationFailure('SCREENSHOT_CANCELED', 'screenshot-destination', 'Screenshot canceled.')
  }
  return captureDeviceScreenshot(validatedRuntime, validatedSerial, result.filePath)
})
handle(
  'device:automation',
  (_event, runtime: RuntimeConfig, serial: string, steps: AutomationStep[]) =>
    runDeviceAutomation(runtimeConfig(runtime), deviceSerial(serial), automationSteps(steps))
)
handle('device:overview', async (_event, runtime: RuntimeConfig, serial: string) => {
  try {
    return { ok: true, data: await deviceWorkspaceService.overview(runtimeConfig(runtime), availableDeviceSerial(serial)) }
  } catch (error) {
    return failureFromUnknown(error, 'DEVICE_OVERVIEW_FAILED', 'device-overview', 'Unable to read device details.', {
      retryable: true,
      suggestedActions: ['Confirm that the device is connected and authorized.']
    })
  }
})
handle('device:push-files', async (
  _event,
  runtime: RuntimeConfig,
  serials: string[],
  target: string,
  conflict: FileConflictPolicy
) => {
  try {
    const validatedRuntime = runtimeConfig(runtime)
    const validatedSerials = availableDeviceSerials(serials)
    const validatedTarget = validateRemoteDirectory(boundedString(target, 'remote target', 1_024))
    if (conflict !== 'replace' && conflict !== 'skip') throw new TypeError('file conflict policy is not supported.')
    const selection = await dialog.showOpenDialog({ title: 'Choose files to push', properties: ['openFile', 'multiSelections'] })
    if (selection.canceled || selection.filePaths.length === 0) {
      return operationFailure('FILE_SELECTION_CANCELED', 'file-selection', 'File selection canceled.')
    }
    const batch = await deviceWorkspaceService.pushFiles(
      validatedRuntime,
      validatedSerials,
      await selectedFiles(selection.filePaths),
      validatedTarget,
      conflict,
      sendBatchProgress
    )
    return { ok: true, data: batch }
  } catch (error) {
    return failureFromUnknown(error, 'FILE_PUSH_PREPARE_FAILED', 'file-push', 'Unable to prepare the file transfer.')
  }
})
handle('device:install-apk', async (
  _event,
  runtime: RuntimeConfig,
  serials: string[],
  replace: boolean,
  downgrade: boolean
) => {
  try {
    const validatedRuntime = runtimeConfig(runtime)
    const validatedSerials = availableDeviceSerials(serials)
    const allowReplace = strictBoolean(replace, 'replace existing app')
    const allowDowngrade = strictBoolean(downgrade, 'allow downgrade')
    const selection = await dialog.showOpenDialog({
      title: 'Choose an APK to install', properties: ['openFile'], filters: [{ name: 'Android package', extensions: ['apk'] }]
    })
    if (selection.canceled || !selection.filePaths[0]) {
      return operationFailure('APK_SELECTION_CANCELED', 'apk-selection', 'APK selection canceled.')
    }
    const [file] = await selectedFiles([selection.filePaths[0]], new Set(['.apk']))
    const batch = await deviceWorkspaceService.installApk(
      validatedRuntime, validatedSerials, file, allowReplace, allowDowngrade, sendBatchProgress
    )
    return { ok: true, data: batch }
  } catch (error) {
    return failureFromUnknown(error, 'APK_INSTALL_PREPARE_FAILED', 'apk-install', 'Unable to prepare the APK installation.')
  }
})
handle('device:apps', async (_event, runtime: RuntimeConfig, serial: string, refresh: boolean) => {
  try {
    return {
      ok: true,
      data: await deviceWorkspaceService.listApps(
        runtimeConfig(runtime),
        availableDeviceSerial(serial),
        strictBoolean(refresh, 'refresh app list')
      )
    }
  } catch (error) {
    return failureFromUnknown(error, 'APP_LIST_FAILED', 'app-list', 'Unable to list installed applications.', {
      retryable: true,
      suggestedActions: ['Confirm that the device is connected and authorized.']
    })
  }
})
handle('device:start-app', async (_event, runtime: RuntimeConfig, serial: string, packageId: string) => {
  try {
    return {
      ok: true,
      data: await deviceWorkspaceService.startApp(
        runtimeConfig(runtime),
        availableDeviceSerial(serial),
        validatePackageId(boundedString(packageId, 'package id', 255))
      )
    }
  } catch (error) {
    return failureFromUnknown(error, 'APP_START_FAILED', 'app-start', 'Unable to start the application.', {
      retryable: true,
      suggestedActions: ['Confirm that the package has a launcher activity.']
    })
  }
})
handle('shell:open', async (_event, rawUrl: string) => {
  const url = new URL(boundedString(rawUrl, 'external URL', 2048))
  const allowedHosts = new Set(['github.com', 'scrcpyapp.org'])
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw new Error('External URL is not allowed.')
  await shell.openExternal(url.toString())
})

app.whenReady().then(() => {
  configRepository = new ConfigRepository(app.getPath('userData'))
  configureSessionSecurity()
  createWindow()
  createTray()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
})

app.on('before-quit', (event) => {
  isQuitting = true
  globalShortcut.unregisterAll()
  stopAllScrcpy()
  stopDeviceTracker()
  if (killAdbOnQuit && !shutdownStarted) {
    event.preventDefault()
    shutdownStarted = true
    void stopAdbServer(quitRuntime).finally(() => app.quit())
  }
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, session, shell, Tray } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  AutomationStep,
  DeviceControlAction,
  DeviceLaunch,
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
  pairDevice,
  runDeviceAutomation,
  startScrcpy,
  stopAdbServer,
  stopAllScrcpy,
  stopScrcpy,
  stopScrcpySession,
  subscribeScrcpySessionEvents
} from './processes'
import {
  automationSteps,
  boundedString,
  controlAction,
  deviceLaunches,
  deviceSerial,
  nonNegativeInteger,
  runtimeConfig,
  strictBoolean
} from './ipcValidation'
import { isTrustedRendererUrl, PRODUCTION_CSP } from './security'
import { buildScrcpyArgs } from './scrcpy'
import { ConfigRepository } from './configRepository'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let minimizeToTray = false
let isQuitting = false
let registeredBossKey = ''
let killAdbOnQuit = false
let quitRuntime: RuntimeConfig = { scrcpyPath: '' }
let shutdownStarted = false
let configRepository: ConfigRepository | undefined
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

const handle: typeof ipcMain.handle = (channel, listener) => {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event)
    return listener(event, ...args)
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
}

subscribeScrcpySessionEvents(sendSessionEvent)

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
  if (!shortcut) return { ok: false, error: 'Enter a boss key shortcut.' }
  try {
    const registered = globalShortcut.register(shortcut, () => {
      stopAllScrcpy('boss-key')
      mainWindow?.hide()
    })
    if (!registered) return { ok: false, error: `The shortcut ${shortcut} is already in use.` }
    registeredBossKey = shortcut
    return { ok: true, data: shortcut }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

handle('app:version', () => app.getVersion())
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
handle('scrcpy:preview', (_event, launches: DeviceLaunch[]) => {
  try {
    return {
      ok: true,
      data: deviceLaunches(launches).map(({ serial, launch }) => ({ serial, args: buildScrcpyArgs(launch, serial) }))
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
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
  if (result.canceled || !result.filePath) return { ok: false, error: 'Screenshot canceled.' }
  return captureDeviceScreenshot(validatedRuntime, validatedSerial, result.filePath)
})
handle(
  'device:automation',
  (_event, runtime: RuntimeConfig, serial: string, steps: AutomationStep[]) =>
    runDeviceAutomation(runtimeConfig(runtime), deviceSerial(serial), automationSteps(steps))
)
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
  if (killAdbOnQuit && !shutdownStarted) {
    event.preventDefault()
    shutdownStarted = true
    void stopAdbServer(quitRuntime).finally(() => app.quit())
  }
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

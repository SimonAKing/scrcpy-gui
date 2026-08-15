import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, session, shell, Tray } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  AutomationStep,
  DeviceControlAction,
  DeviceLaunch,
  OperationResult,
  RuntimeConfig,
  ScrcpyStatusEvent
} from '../shared/types'
import {
  captureDeviceScreenshot,
  connectDevice,
  controlDevice,
  disconnectDevice,
  getEnvironment,
  listDevices,
  pairDevice,
  runDeviceAutomation,
  startScrcpy,
  stopAdbServer,
  stopAllScrcpy,
  stopScrcpy
} from './processes'
import { isTrustedRendererUrl, PRODUCTION_CSP } from './security'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let minimizeToTray = false
let isQuitting = false
let registeredBossKey = ''
let killAdbOnQuit = false
let quitRuntime: RuntimeConfig = { scrcpyPath: '' }
let shutdownStarted = false
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
      stopAllScrcpy()
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
  minimizeToTray = Boolean(enabled)
})
handle('app:quit-behavior', (_event, runtime: RuntimeConfig, shouldKillAdb: boolean) => {
  quitRuntime = { scrcpyPath: String(runtime?.scrcpyPath || '') }
  killAdbOnQuit = Boolean(shouldKillAdb)
})
handle('app:boss-key', (_event, enabled: boolean, accelerator: string) =>
  setBossKey(Boolean(enabled), String(accelerator || ''))
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
handle('system:environment', (_event, runtime: RuntimeConfig) => getEnvironment(runtime))
handle('device:list', (_event, runtime: RuntimeConfig) => listDevices(runtime))
handle('device:connect', (_event, runtime: RuntimeConfig, target: string) => connectDevice(runtime, target))
handle('device:pair', (_event, runtime: RuntimeConfig, target: string, code: string) =>
  pairDevice(runtime, target, code)
)
handle('device:disconnect', (_event, runtime: RuntimeConfig, target: string) =>
  disconnectDevice(runtime, target)
)
handle(
  'scrcpy:start',
  (_event, runtime: RuntimeConfig, launches: DeviceLaunch[]) =>
    startScrcpy(runtime, launches, sendStatus)
)
handle('scrcpy:stop', (_event, serial: string) => stopScrcpy(serial))
handle(
  'device:control',
  (_event, runtime: RuntimeConfig, serial: string, action: DeviceControlAction) =>
    controlDevice(runtime, serial, action)
)
handle('device:screenshot', async (_event, runtime: RuntimeConfig, serial: string) => {
  const safeSerial = serial.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'device'
  const timestamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19)
  const result = await dialog.showSaveDialog({
    title: 'Save device screenshot',
    defaultPath: join(app.getPath('pictures'), `scrcpy-${safeSerial}-${timestamp}.png`),
    filters: [{ name: 'PNG image', extensions: ['png'] }]
  })
  if (result.canceled || !result.filePath) return { ok: false, error: 'Screenshot canceled.' }
  return captureDeviceScreenshot(runtime, serial, result.filePath)
})
handle(
  'device:automation',
  (_event, runtime: RuntimeConfig, serial: string, steps: AutomationStep[]) =>
    runDeviceAutomation(runtime, serial, steps)
)
handle('shell:open', async (_event, rawUrl: string) => {
  const url = new URL(rawUrl)
  const allowedHosts = new Set(['github.com', 'scrcpyapp.org'])
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw new Error('External URL is not allowed.')
  await shell.openExternal(url.toString())
})

app.whenReady().then(() => {
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

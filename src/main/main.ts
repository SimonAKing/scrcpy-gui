import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { join } from 'node:path'
import type { LaunchConfig, RuntimeConfig, ScrcpyStatusEvent } from '../shared/types'
import {
  connectDevice,
  disconnectDevice,
  getEnvironment,
  listDevices,
  pairDevice,
  startScrcpy,
  stopAllScrcpy,
  stopScrcpy
} from './processes'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let minimizeToTray = false
let isQuitting = false

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

ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('app:minimize-to-tray', (_event, enabled: boolean) => {
  minimizeToTray = Boolean(enabled)
})
ipcMain.handle('dialog:scrcpy', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose the scrcpy executable',
    properties: ['openFile'],
    filters: process.platform === 'win32' ? [{ name: 'scrcpy', extensions: ['exe'] }] : []
  })
  return result.canceled ? '' : result.filePaths[0] || ''
})
ipcMain.handle('dialog:record', async () => {
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
ipcMain.handle('system:environment', (_event, runtime: RuntimeConfig) => getEnvironment(runtime))
ipcMain.handle('device:list', (_event, runtime: RuntimeConfig) => listDevices(runtime))
ipcMain.handle('device:connect', (_event, runtime: RuntimeConfig, target: string) => connectDevice(runtime, target))
ipcMain.handle('device:pair', (_event, runtime: RuntimeConfig, target: string, code: string) =>
  pairDevice(runtime, target, code)
)
ipcMain.handle('device:disconnect', (_event, runtime: RuntimeConfig, target: string) =>
  disconnectDevice(runtime, target)
)
ipcMain.handle(
  'scrcpy:start',
  (_event, runtime: RuntimeConfig, launch: LaunchConfig, serials: string[]) =>
    startScrcpy(runtime, launch, serials, sendStatus)
)
ipcMain.handle('scrcpy:stop', (_event, serial: string) => stopScrcpy(serial))
ipcMain.handle('shell:open', async (_event, rawUrl: string) => {
  const url = new URL(rawUrl)
  const allowedHosts = new Set(['github.com', 'scrcpyapp.org'])
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw new Error('External URL is not allowed.')
  await shell.openExternal(url.toString())
})

app.whenReady().then(() => {
  createWindow()
  createTray()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  stopAllScrcpy()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

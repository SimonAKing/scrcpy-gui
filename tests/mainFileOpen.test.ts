import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  ready: false, directory: '',
  appListeners: new Map<string, (...args: any[]) => any>(),
  ipcHandlers: new Map<string, (...args: any[]) => any>(),
  inputListeners: new Map<string, (...args: any[]) => any>(),
  resolveReady: undefined as (() => void) | undefined,
  window: undefined as any,
  showMessageBox: vi.fn(async (_window: unknown, _options: unknown) => ({ response: 0, checkboxChecked: false })),
  register: vi.fn(), listDevices: vi.fn(async (_runtime: unknown) => ({ ok: true, data: [
    { serial: 'PHONE', model: 'Pixel', product: 'pixel', device: 'pixel', state: 'device', connection: 'usb' }
  ] }))
}))

vi.mock('electron', () => ({
  app: {
    on: (name: string, callback: (...args: any[]) => any) => state.appListeners.set(name, callback),
    whenReady: () => new Promise<void>(resolve => { state.resolveReady = resolve }),
    isReady: () => state.ready, isPackaged: false,
    getPath: () => state.directory, getAppPath: () => state.directory
  },
  BrowserWindow: class {
    focused = true
    webContents = {
      mainFrame: { url: '' }, send: vi.fn(),
      on: (name: string, callback: (...args: any[]) => any) => state.inputListeners.set(name, callback),
      setWindowOpenHandler: vi.fn(), getURL: () => this.webContents.mainFrame.url
    }
    constructor() { state.window = this }
    setMenuBarVisibility() {}
    once() {}
    on() {}
    show() {}
    focus() {}
    isDestroyed() { return false }
    isFocused() { return this.focused }
    async loadFile(path: string) { this.webContents.mainFrame.url = pathToFileURL(path).toString() }
  },
  clipboard: {}, dialog: { showMessageBox: state.showMessageBox },
  globalShortcut: { register: state.register },
  ipcMain: { handle: (name: string, callback: (...args: any[]) => any) => state.ipcHandlers.set(name, callback) },
  Menu: { buildFromTemplate: () => ({}) },
  nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
  session: { defaultSession: { setPermissionRequestHandler() {} } }, shell: {},
  Tray: class { setToolTip() {} setContextMenu() {} on() {} }
}))

vi.mock('../src/main/processes', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/processes')>(), listDevices: state.listDevices
}))

afterAll(async () => {
  vi.restoreAllMocks()
  if (state.directory) await rm(state.directory, { recursive: true, force: true })
})

describe('main-process file opening and shortcut boundaries', () => {
  it('waits for migrated runtime configuration before processing a cold-start APK', async () => {
    state.directory = await mkdtemp(join(tmpdir(), 'scrcpy-main-open-'))
    const apk = join(state.directory, 'example.apk')
    await writeFile(apk, 'mock APK; never installed')
    await import('../src/main/main.js')
    state.appListeners.get('open-file')!({ preventDefault() {} }, apk)
    expect(state.listDevices).not.toHaveBeenCalled()
    state.ready = true
    state.resolveReady!()
    await vi.waitFor(() => expect(state.window).toBeDefined())
    expect(state.listDevices).not.toHaveBeenCalled()
    expect(state.register).not.toHaveBeenCalled()
    const window = state.window
    const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    await state.ipcHandlers.get('config:load')!(event,
      JSON.stringify({ runtime: { scrcpyPath: '/custom/scrcpy' } }), 'en')
    await vi.waitFor(() => expect(state.showMessageBox).toHaveBeenCalled())
    expect(state.listDevices).toHaveBeenCalledWith({ scrcpyPath: '/custom/scrcpy' })
    expect(state.showMessageBox.mock.calls[0][1]).toMatchObject({ defaultId: 0, cancelId: 0, checkboxChecked: false })
  })

  it('rejects config loading from an untrusted sender', async () => {
    await expect(state.ipcHandlers.get('config:load')!({ sender: {}, senderFrame: {} }, '', 'en'))
      .rejects.toThrow('untrusted renderer')
  })

  it('does not dispatch device shortcuts from a hidden or untrusted window', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const event = { preventDefault: vi.fn() }
    const input = { type: 'keyDown', key: 'c', meta: true, shift: true, control: false, alt: false }
    const listener = state.inputListeners.get('before-input-event')!
    const window = state.window
    window.webContents.send.mockClear()
    window.focused = false
    listener(event, input)
    expect(window.webContents.send).not.toHaveBeenCalled()
    window.focused = true
    const url = window.webContents.mainFrame.url
    window.webContents.mainFrame.url = 'https://untrusted.example/'
    listener(event, input)
    expect(window.webContents.send).not.toHaveBeenCalled()
    window.webContents.mainFrame.url = url
    listener(event, input)
    expect(window.webContents.send).toHaveBeenCalledWith('app:screenshot-shortcut', 'copy')
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })
})

import { contextBridge, ipcRenderer } from 'electron'
import type { LaunchConfig, RuntimeConfig, ScrcpyApi, ScrcpyStatusEvent } from '../shared/types'

const api: ScrcpyApi = {
  getVersion: () => ipcRenderer.invoke('app:version'),
  chooseScrcpy: () => ipcRenderer.invoke('dialog:scrcpy'),
  chooseRecordPath: () => ipcRenderer.invoke('dialog:record'),
  getEnvironment: (runtime: RuntimeConfig) => ipcRenderer.invoke('system:environment', runtime),
  listDevices: (runtime: RuntimeConfig) => ipcRenderer.invoke('device:list', runtime),
  connect: (runtime: RuntimeConfig, target: string) => ipcRenderer.invoke('device:connect', runtime, target),
  pair: (runtime: RuntimeConfig, target: string, code: string) => ipcRenderer.invoke('device:pair', runtime, target, code),
  disconnect: (runtime: RuntimeConfig, target: string) => ipcRenderer.invoke('device:disconnect', runtime, target),
  start: (runtime: RuntimeConfig, launch: LaunchConfig, serials: string[]) =>
    ipcRenderer.invoke('scrcpy:start', runtime, launch, serials),
  stop: (serial: string) => ipcRenderer.invoke('scrcpy:stop', serial),
  setMinimizeToTray: (enabled: boolean) => ipcRenderer.invoke('app:minimize-to-tray', enabled),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open', url),
  onStatus: (callback: (event: ScrcpyStatusEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: ScrcpyStatusEvent): void => callback(status)
    ipcRenderer.on('scrcpy:status', listener)
    return () => ipcRenderer.removeListener('scrcpy:status', listener)
  }
}

contextBridge.exposeInMainWorld('scrcpy', api)

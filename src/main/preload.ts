import { contextBridge, ipcRenderer } from 'electron'
import type {
  AutomationStep,
  DeviceControlAction,
  DeviceLaunch,
  RuntimeConfig,
  ScrcpyApi,
  ScrcpyStatusEvent
} from '../shared/types'

const api: ScrcpyApi = {
  getVersion: () => ipcRenderer.invoke('app:version'),
  chooseScrcpy: () => ipcRenderer.invoke('dialog:scrcpy'),
  chooseRecordPath: () => ipcRenderer.invoke('dialog:record'),
  chooseRecordDirectory: () => ipcRenderer.invoke('dialog:record-directory'),
  getEnvironment: (runtime: RuntimeConfig) => ipcRenderer.invoke('system:environment', runtime),
  listDevices: (runtime: RuntimeConfig) => ipcRenderer.invoke('device:list', runtime),
  connect: (runtime: RuntimeConfig, target: string) => ipcRenderer.invoke('device:connect', runtime, target),
  pair: (runtime: RuntimeConfig, target: string, code: string) => ipcRenderer.invoke('device:pair', runtime, target, code),
  disconnect: (runtime: RuntimeConfig, target: string) => ipcRenderer.invoke('device:disconnect', runtime, target),
  start: (runtime: RuntimeConfig, launches: DeviceLaunch[]) =>
    ipcRenderer.invoke('scrcpy:start', runtime, launches),
  stop: (serial: string) => ipcRenderer.invoke('scrcpy:stop', serial),
  control: (runtime: RuntimeConfig, serial: string, action: DeviceControlAction) =>
    ipcRenderer.invoke('device:control', runtime, serial, action),
  screenshot: (runtime: RuntimeConfig, serial: string) =>
    ipcRenderer.invoke('device:screenshot', runtime, serial),
  runAutomation: (runtime: RuntimeConfig, serial: string, steps: AutomationStep[]) =>
    ipcRenderer.invoke('device:automation', runtime, serial, steps),
  setMinimizeToTray: (enabled: boolean) => ipcRenderer.invoke('app:minimize-to-tray', enabled),
  setQuitBehavior: (runtime: RuntimeConfig, killAdbOnQuit: boolean) =>
    ipcRenderer.invoke('app:quit-behavior', runtime, killAdbOnQuit),
  setBossKey: (enabled: boolean, accelerator: string) =>
    ipcRenderer.invoke('app:boss-key', enabled, accelerator),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open', url),
  onStatus: (callback: (event: ScrcpyStatusEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: ScrcpyStatusEvent): void => callback(status)
    ipcRenderer.on('scrcpy:status', listener)
    return () => ipcRenderer.removeListener('scrcpy:status', listener)
  }
}

contextBridge.exposeInMainWorld('scrcpy', api)

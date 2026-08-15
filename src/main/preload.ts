import { contextBridge, ipcRenderer } from 'electron'
import type {
  AutomationStep,
  AppEvent,
  AppEventQuery,
  ArtifactQuery,
  BatchProgressEvent,
  FileConflictPolicy,
  LaunchProfile,
  LaunchConfig,
  ProfileImportStrategy,
  CommandPreviewRequest,
  DeviceControlAction,
  DeviceLaunch,
  DeviceTrackerEvent,
  Locale,
  PersistedConfig,
  RuntimeConfig,
  ScrcpyApi,
  ScrcpySessionEvent,
  ScrcpyStatusEvent
} from '../shared/types'

const api: ScrcpyApi = {
  getVersion: () => ipcRenderer.invoke('app:version'),
  listEvents: (query: AppEventQuery) => ipcRenderer.invoke('events:list', query),
  clearEvents: () => ipcRenderer.invoke('events:clear'),
  chooseScrcpy: () => ipcRenderer.invoke('dialog:scrcpy'),
  chooseRecordPath: () => ipcRenderer.invoke('dialog:record'),
  chooseRecordDirectory: () => ipcRenderer.invoke('dialog:record-directory'),
  loadConfig: (legacyJson: string, locale: Locale) => ipcRenderer.invoke('config:load', legacyJson, locale),
  saveConfig: (revision: number, config: PersistedConfig) => ipcRenderer.invoke('config:save', revision, config),
  getEnvironment: (runtime: RuntimeConfig) => ipcRenderer.invoke('system:environment', runtime),
  listDevices: (runtime: RuntimeConfig) => ipcRenderer.invoke('device:list', runtime),
  trackDevices: (runtime: RuntimeConfig) => ipcRenderer.invoke('device:track', runtime),
  setDeviceTrackerVisibility: (visible: boolean) => ipcRenderer.invoke('device:visibility', visible),
  connect: (runtime: RuntimeConfig, target: string) => ipcRenderer.invoke('device:connect', runtime, target),
  pair: (runtime: RuntimeConfig, target: string, code: string) => ipcRenderer.invoke('device:pair', runtime, target, code),
  disconnect: (runtime: RuntimeConfig, target: string) => ipcRenderer.invoke('device:disconnect', runtime, target),
  start: (runtime: RuntimeConfig, launches: DeviceLaunch[]) =>
    ipcRenderer.invoke('scrcpy:start', runtime, launches),
  preview: (launches: CommandPreviewRequest[]) => ipcRenderer.invoke('scrcpy:preview', launches),
  startOtg: (runtime: RuntimeConfig, launch: LaunchConfig, usbSerial: string) =>
    ipcRenderer.invoke('scrcpy:start-otg', runtime, launch, usbSerial),
  previewOtg: (launch: LaunchConfig, usbSerial: string) => ipcRenderer.invoke('scrcpy:preview-otg', launch, usbSerial),
  listSessions: () => ipcRenderer.invoke('session:list'),
  stopSession: (id: string) => ipcRenderer.invoke('session:stop', id),
  stop: (serial: string) => ipcRenderer.invoke('scrcpy:stop', serial),
  control: (runtime: RuntimeConfig, serial: string, action: DeviceControlAction) =>
    ipcRenderer.invoke('device:control', runtime, serial, action),
  screenshot: (runtime: RuntimeConfig, serial: string) =>
    ipcRenderer.invoke('device:screenshot', runtime, serial),
  runAutomation: (runtime: RuntimeConfig, serial: string, steps: AutomationStep[]) =>
    ipcRenderer.invoke('device:automation', runtime, serial, steps),
  getDeviceOverview: (runtime: RuntimeConfig, serial: string) => ipcRenderer.invoke('device:overview', runtime, serial),
  pushFiles: (runtime: RuntimeConfig, serials: string[], target: string, conflict: FileConflictPolicy) =>
    ipcRenderer.invoke('device:push-files', runtime, serials, target, conflict),
  installApk: (runtime: RuntimeConfig, serials: string[], replace: boolean, downgrade: boolean) =>
    ipcRenderer.invoke('device:install-apk', runtime, serials, replace, downgrade),
  listApps: (runtime: RuntimeConfig, serial: string, refresh: boolean) =>
    ipcRenderer.invoke('device:apps', runtime, serial, refresh),
  startApp: (runtime: RuntimeConfig, serial: string, packageId: string) =>
    ipcRenderer.invoke('device:start-app', runtime, serial, packageId),
  listArtifacts: (query: ArtifactQuery) => ipcRenderer.invoke('artifact:list', query),
  openArtifact: (id: string) => ipcRenderer.invoke('artifact:open', id),
  revealArtifact: (id: string) => ipcRenderer.invoke('artifact:reveal', id),
  copyArtifactPath: (id: string) => ipcRenderer.invoke('artifact:copy-path', id),
  deleteArtifact: (id: string, deleteFile: boolean) => ipcRenderer.invoke('artifact:delete', id, deleteFile),
  previewDiagnostics: (runtime: RuntimeConfig) => ipcRenderer.invoke('diagnostics:preview', runtime),
  exportDiagnostics: (runtime: RuntimeConfig) => ipcRenderer.invoke('diagnostics:export', runtime),
  openIssueHelper: (artifactId?: string) => ipcRenderer.invoke('diagnostics:issue-helper', artifactId),
  exportProfile: (profile: LaunchProfile) => ipcRenderer.invoke('profile:export', profile),
  previewProfileImport: (runtime: RuntimeConfig) => ipcRenderer.invoke('profile:import-preview', runtime),
  commitProfileImport: (token: string, strategy: ProfileImportStrategy, keepMachinePaths: boolean) =>
    ipcRenderer.invoke('profile:import-commit', token, strategy, keepMachinePaths),
  probeDeviceCapabilities: (runtime: RuntimeConfig, serial: string, refresh = false) =>
    ipcRenderer.invoke('capability:device-probe', runtime, serial, refresh),
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
  },
  onSession: (callback: (event: ScrcpySessionEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, sessionEvent: ScrcpySessionEvent): void => callback(sessionEvent)
    ipcRenderer.on('session:event', listener)
    return () => ipcRenderer.removeListener('session:event', listener)
  },
  onDevices: (callback: (event: DeviceTrackerEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, deviceEvent: DeviceTrackerEvent): void => callback(deviceEvent)
    ipcRenderer.on('device:event', listener)
    return () => ipcRenderer.removeListener('device:event', listener)
  },
  onEvent: (callback: (event: AppEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, appEvent: AppEvent): void => callback(appEvent)
    ipcRenderer.on('app:event', listener)
    return () => ipcRenderer.removeListener('app:event', listener)
  },
  onBatchProgress: (callback: (event: BatchProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: BatchProgressEvent): void => callback(progress)
    ipcRenderer.on('batch:progress', listener)
    return () => ipcRenderer.removeListener('batch:progress', listener)
  }
}

contextBridge.exposeInMainWorld('scrcpy', api)

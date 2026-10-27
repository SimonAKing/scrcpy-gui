import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import type { ApkInstallResult, BatchOperationResult, Device, OperationResult, RuntimeConfig } from '../shared/types'
import type { SelectedLocalFile } from './deviceWorkspaceService'

interface OpenApkDependencies {
  listDevices(runtime: RuntimeConfig): Promise<OperationResult<Device[]>>
  showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue>
  installApk(runtime: RuntimeConfig, serials: string[], file: SelectedLocalFile, replace: boolean,
    downgrade: boolean): Promise<BatchOperationResult<ApkInstallResult>>
}

export async function installOpenedApk(runtime: RuntimeConfig, file: SelectedLocalFile, dependencies: OpenApkDependencies) {
  const listed = await dependencies.listDevices(runtime)
  if (!listed.ok) throw new Error(listed.error?.message || 'Unable to list Android devices.')
  const devices = (listed.data || []).filter((device) => device.state === 'device')
  if (!devices.length) {
    await dependencies.showMessageBox({
      type: 'warning', message: `Cannot install ${file.name}`,
      detail: 'Connect and authorize an Android device, then open the APK again.', buttons: ['OK']
    })
    return
  }
  let target = devices[0]
  if (devices.length > 1) {
    const choice = await dependencies.showMessageBox({
      type: 'question', message: `Install ${file.name} on which device?`,
      buttons: ['Cancel', ...devices.map((device) => `${device.model} · ${device.serial}`)],
      defaultId: 0, cancelId: 0, noLink: true
    })
    const selected = devices[choice.response - 1]
    if (!selected) return
    target = selected
  }
  const confirmation = await dependencies.showMessageBox({
    type: 'warning', message: `Install ${file.name}?`,
    detail: `File: ${file.path}\nDevice: ${target.model} · ${target.serial}\nOnly install APKs from sources you trust.`,
    buttons: ['Cancel', 'Install'], defaultId: 0, cancelId: 0, noLink: true,
    checkboxLabel: 'Allow replacing an existing app (Android signature checks still apply)', checkboxChecked: false
  })
  if (confirmation.response !== 1) return
  const batch = await dependencies.installApk(runtime, [target.serial], file, confirmation.checkboxChecked === true, false)
  return { batch, target }
}

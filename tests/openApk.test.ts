import { describe, expect, it, vi } from 'vitest'
import type { Device, RuntimeConfig } from '../src/shared/types'
import { installOpenedApk } from '../src/main/openApk'

const runtime: RuntimeConfig = { scrcpyPath: '/custom/runtime/scrcpy' }
const file = { name: 'example.apk', path: '/downloads/example.apk', size: 100 }
const device: Device = { serial: 'PHONE', model: 'Pixel', product: 'pixel', device: 'pixel', state: 'device', connection: 'usb' }

function setup(devices = [device]) {
  return {
    listDevices: vi.fn(async () => ({ ok: true, data: devices })),
    showMessageBox: vi.fn(async () => ({ response: 0, checkboxChecked: false })),
    installApk: vi.fn(async () => ({ id: 'batch', startedAt: '', completedAt: '', results: [] }))
  }
}

describe('APKs opened through the operating system', () => {
  it('requires confirmation even for a single authorized device and defaults to cancel', async () => {
    const dependencies = setup()
    expect(await installOpenedApk(runtime, file, dependencies)).toBeUndefined()
    expect(dependencies.installApk).not.toHaveBeenCalled()
    expect(dependencies.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      buttons: ['Cancel', 'Install'], defaultId: 0, cancelId: 0, checkboxChecked: false,
      detail: expect.stringContaining(file.path)
    }))
  })

  it.each([false, true])('only replaces when explicitly checked: %s', async (replace) => {
    const dependencies = setup()
    dependencies.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: replace })
    await installOpenedApk(runtime, file, dependencies)
    expect(dependencies.listDevices).toHaveBeenCalledWith(runtime)
    expect(dependencies.installApk).toHaveBeenCalledWith(runtime, ['PHONE'], file, replace, false)
    expect(dependencies.showMessageBox.mock.invocationCallOrder[0])
      .toBeLessThan(dependencies.installApk.mock.invocationCallOrder[0])
  })

  it('does not install on offline or unauthorized devices', async () => {
    const dependencies = setup([{ ...device, state: 'unauthorized' }, { ...device, serial: 'OTHER', state: 'offline' }])
    await installOpenedApk(runtime, file, dependencies)
    expect(dependencies.installApk).not.toHaveBeenCalled()
    expect(dependencies.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning', buttons: ['OK'] }))
  })

  it('allows canceling the device picker and confirms the chosen device separately', async () => {
    const dependencies = setup([device, { ...device, serial: 'SECOND' }])
    await installOpenedApk(runtime, file, dependencies)
    expect(dependencies.installApk).not.toHaveBeenCalled()
    dependencies.showMessageBox.mockResolvedValueOnce({ response: 2, checkboxChecked: false })
      .mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    await installOpenedApk(runtime, file, dependencies)
    expect(dependencies.showMessageBox).toHaveBeenLastCalledWith(expect.objectContaining({ detail: expect.stringContaining('SECOND') }))
    expect(dependencies.installApk).toHaveBeenCalledWith(runtime, ['SECOND'], file, false, false)
  })

  it('fails closed if device enumeration fails', async () => {
    const dependencies = setup()
    dependencies.listDevices.mockResolvedValue({ ok: false, data: [] })
    await expect(installOpenedApk(runtime, file, dependencies)).rejects.toThrow('Unable to list')
    expect(dependencies.installApk).not.toHaveBeenCalled()
  })
})

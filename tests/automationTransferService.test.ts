import { describe, expect, it } from 'vitest'
import { AutomationTransferService } from '../src/main/automationTransferService'

const automation = {
  id: 'macro-1', name: 'Morning setup', description: 'Safe device setup', schemaVersion: 2 as const,
  design: { orientation: 'portrait' as const, aspectRatio: 2.1 },
  steps: [
    { type: 'start-app' as const, packageId: 'com.example.app' },
    { type: 'tap' as const, x: 0.5, y: 0.25, coordinateSpace: 'normalized' as const }
  ]
}

describe('AutomationTransferService', () => {
  it('round-trips a reviewed structured document without running it', () => {
    const service = new AutomationTransferService(() => new Date('2026-08-15T12:00:00.000Z'), () => 'token-1')
    const preview = service.preview(service.serialize(automation, '2.4.0'))
    expect(preview).toMatchObject({ token: 'token-1', trusted: false, dangerousStepCount: 1 })
    expect(preview.warnings).not.toHaveLength(0)
    expect(service.commit(preview.token)).toEqual(automation)
    expect(() => service.commit(preview.token)).toThrow('missing or expired')
  })

  it('rejects arbitrary shell and sensitive text payloads', () => {
    const service = new AutomationTransferService()
    const shell = JSON.stringify({
      schemaVersion: 1, kind: 'scrcpy-gui-automation', appVersion: '2.4.0',
      automation: { ...automation, steps: [{ type: 'shell', command: 'rm -rf /' }] }
    })
    expect(() => service.preview(shell)).toThrow('not supported')

    const sensitive = JSON.stringify({
      schemaVersion: 1, kind: 'scrcpy-gui-automation', appVersion: '2.4.0',
      automation: { ...automation, steps: [{ type: 'text', value: 'password', sensitive: true }] }
    })
    expect(() => service.preview(sensitive)).toThrow('Sensitive text')
  })
})

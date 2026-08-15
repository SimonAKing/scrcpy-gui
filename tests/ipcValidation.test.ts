import { describe, expect, it } from 'vitest'
import type { LaunchConfig } from '../src/shared/types'
import { defaultLaunchConfig } from '../src/shared/config'
import {
  automationSteps,
  automationMacro,
  batchPreflightRequest,
  boundedString,
  commandPreviewRequests,
  controlAction,
  deviceLaunches,
  deviceSerial,
  deviceSerials,
  launchConfig,
  nonNegativeInteger,
  runtimeConfig,
  strictBoolean
} from '../src/main/ipcValidation'

function validLaunch(overrides: Partial<LaunchConfig> = {}): LaunchConfig {
  return { ...defaultLaunchConfig(), ...overrides }
}

describe('IPC scalar validation', () => {
  it('accepts bounded strings and exact booleans', () => {
    expect(boundedString('device', 'name', 20)).toBe('device')
    expect(strictBoolean(false, 'enabled')).toBe(false)
    expect(deviceSerial('ABC123')).toBe('ABC123')
    expect(deviceSerials(['ABC123', 'ABC123', 'SECOND'])).toEqual(['ABC123', 'SECOND'])
    expect(controlAction('home')).toBe('home')
    expect(nonNegativeInteger(0, 'revision')).toBe(0)
  })

  it('rejects coercion, null bytes and oversized values', () => {
    expect(() => strictBoolean(1, 'enabled')).toThrow('must be a boolean')
    expect(() => boundedString('bad\0value', 'name', 20)).toThrow('null bytes')
    expect(() => deviceSerial('')).toThrow('1 to 512')
    expect(() => deviceSerial('x'.repeat(513))).toThrow('1 to 512')
    expect(() => deviceSerials([])).toThrow('1 to 20')
    expect(() => deviceSerials(Array.from({ length: 21 }, (_, index) => `device-${index}`))).toThrow('1 to 20')
    expect(() => controlAction('shell')).toThrow('not supported')
    expect(() => nonNegativeInteger(-1, 'revision')).toThrow('non-negative safe integer')
    expect(() => nonNegativeInteger(1.5, 'revision')).toThrow('non-negative safe integer')
  })
})

describe('IPC runtime and launch validation', () => {
  it('normalizes valid runtime and launch requests', () => {
    expect(runtimeConfig({ scrcpyPath: '' })).toEqual({ scrcpyPath: '' })
    expect(launchConfig(validLaunch({ videoCodec: 'vp9', maxFps: 120 }))).toMatchObject({
      videoCodec: 'vp9', maxFps: 120
    })
    expect(deviceLaunches([{ serial: 'ABC123', launch: validLaunch() }])).toHaveLength(1)
  })

  it('rejects malformed launch values before process construction', () => {
    expect(() => runtimeConfig({ scrcpyPath: 12 })).toThrow('must be a string')
    expect(() => launchConfig({ ...validLaunch(), maxFps: Number.NaN })).toThrow('finite number')
    expect(() => launchConfig({ ...validLaunch(), videoCodec: 'mpeg2' })).toThrow('not supported')
    expect(() => launchConfig({ ...validLaunch(), audio: 'yes' })).toThrow('must be a boolean')
    expect(() => launchConfig({ ...validLaunch(), extraArgs: `${'x'.repeat(4097)}\n` })).toThrow('at most 200 lines')
  })

  it('limits batch launch size', () => {
    expect(() => deviceLaunches([])).toThrow('1 to 100')
    expect(() => deviceLaunches(Array.from({ length: 101 }, (_, index) => ({
      serial: `device-${index}`, launch: validLaunch()
    })))).toThrow('1 to 100')
  })

  it('validates command provenance instead of trusting Renderer labels', () => {
    expect(commandPreviewRequests([{
      serial: 'ABC', launch: validLaunch(), source: 'profile', profileName: 'Gaming', deviceWindowTitleOverride: true
    }])).toMatchObject([{ serial: 'ABC', source: 'profile', profileName: 'Gaming', deviceWindowTitleOverride: true }])
    expect(() => commandPreviewRequests([{
      serial: 'ABC', launch: validLaunch(), source: 'profile', deviceWindowTitleOverride: false
    }])).toThrow('profileName is required')
    expect(() => commandPreviewRequests([{
      serial: 'ABC', launch: validLaunch(), source: 'remote', deviceWindowTitleOverride: false
    }])).toThrow('not supported')
  })
})

describe('IPC automation validation', () => {
  it('accepts safe actions and delays', () => {
    expect(automationSteps([{ action: 'back', delayMs: 250 }])).toEqual([
      { type: 'delay', durationMs: 250 },
      { type: 'control', action: 'back' }
    ])
    expect(automationSteps([
      { type: 'tap', x: 0.25, y: 0.75, coordinateSpace: 'normalized' },
      { type: 'swipe', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, durationMs: 250, coordinateSpace: 'normalized' },
      { type: 'text', value: 'hello world', sensitive: false },
      { type: 'start-app', packageId: 'com.example.app' },
      { type: 'assert-device', condition: { type: 'orientation', value: 'portrait' } }
    ])).toHaveLength(5)
  })

  it('rejects unsafe, oversized and overlong automations', () => {
    expect(() => automationSteps([{ action: 'shell', delayMs: 0 }])).toThrow('not supported')
    expect(() => automationSteps([{ action: 'home', delayMs: 60_001 }])).toThrow('0 to 60000')
    expect(() => automationSteps(Array.from({ length: 31 }, () => ({ action: 'home', delayMs: 60_000 })))).toThrow(
      '30 minutes'
    )
    expect(() => automationSteps(Array.from({ length: 201 }, () => ({ action: 'home', delayMs: 0 })))).toThrow(
      '1 to 200'
    )
    expect(() => automationSteps([{ type: 'tap', x: 1.1, y: 0, coordinateSpace: 'normalized' }])).toThrow('0 to 1')
    expect(() => automationSteps([{ type: 'text', value: 'token', sensitive: true }])).toThrow('Sensitive text')
    expect(() => automationSteps([{ type: 'text', value: 'hello; reboot', sensitive: false }])).toThrow('unsafe')
    expect(() => automationSteps([{ type: 'shell', command: 'id' }])).toThrow('not supported')
  })

  it('validates frozen automation and batch plans', () => {
    const macro = automationMacro({
      id: 'macro', name: 'Launch', steps: [{ action: 'home', delayMs: 0 }]
    })
    expect(macro).toMatchObject({ schemaVersion: 2, description: '', design: { orientation: 'any', aspectRatio: 0 } })
    const plan = batchPreflightRequest({
      serials: ['ABC'], concurrencyLimit: 1,
      action: { type: 'automation', automation: macro }
    })
    expect(plan.action.type).toBe('automation')
    expect(() => batchPreflightRequest({
      serials: ['ABC'], concurrencyLimit: 9, action: { type: 'screenshot' }
    })).toThrow('1 to 8')
    expect(() => batchPreflightRequest({
      serials: ['ABC'], concurrencyLimit: 1, action: { type: 'launch', launches: [] }
    })).toThrow('1 to 100')
  })
})

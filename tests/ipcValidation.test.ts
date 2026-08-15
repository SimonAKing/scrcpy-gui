import { describe, expect, it } from 'vitest'
import type { LaunchConfig } from '../src/shared/types'
import {
  automationSteps,
  boundedString,
  controlAction,
  deviceLaunches,
  deviceSerial,
  launchConfig,
  nonNegativeInteger,
  runtimeConfig,
  strictBoolean
} from '../src/main/ipcValidation'

function validLaunch(overrides: Partial<LaunchConfig> = {}): LaunchConfig {
  return {
    windowTitle: '', videoBitRate: 8, videoBuffer: 0, audioBuffer: 0, maxSize: 0, maxFps: 0, displayId: 0,
    orientation: '0', videoCodec: 'default', shortcutModifier: 'default', keyboardMode: 'default',
    mouseMode: 'default', gamepadMode: 'default', alwaysOnTop: false, control: true, audio: true,
    turnScreenOff: false, stayAwake: false, showTouches: false, fullscreen: false, borderless: false,
    windowAspectRatioLock: true, pushTarget: '', tunnelPort: '', recordEnabled: false, recordPath: '',
    autoRecordName: false, recordDirectory: '', noPlayback: false,
    crop: { x: 0, y: 0, width: 0, height: 0 }, window: { x: 0, y: 0, width: 0, height: 0 }, extraArgs: '',
    ...overrides
  }
}

describe('IPC scalar validation', () => {
  it('accepts bounded strings and exact booleans', () => {
    expect(boundedString('device', 'name', 20)).toBe('device')
    expect(strictBoolean(false, 'enabled')).toBe(false)
    expect(deviceSerial('ABC123')).toBe('ABC123')
    expect(controlAction('home')).toBe('home')
    expect(nonNegativeInteger(0, 'revision')).toBe(0)
  })

  it('rejects coercion, null bytes and oversized values', () => {
    expect(() => strictBoolean(1, 'enabled')).toThrow('must be a boolean')
    expect(() => boundedString('bad\0value', 'name', 20)).toThrow('null bytes')
    expect(() => deviceSerial('')).toThrow('1 to 512')
    expect(() => deviceSerial('x'.repeat(513))).toThrow('1 to 512')
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
})

describe('IPC automation validation', () => {
  it('accepts safe actions and delays', () => {
    expect(automationSteps([{ action: 'back', delayMs: 250 }])).toEqual([{ action: 'back', delayMs: 250 }])
  })

  it('rejects unsafe, oversized and overlong automations', () => {
    expect(() => automationSteps([{ action: 'shell', delayMs: 0 }])).toThrow('not supported')
    expect(() => automationSteps([{ action: 'home', delayMs: 60_001 }])).toThrow('0 to 60000')
    expect(() => automationSteps(Array.from({ length: 31 }, () => ({ action: 'home', delayMs: 60_000 })))).toThrow(
      '30 minutes'
    )
    expect(() => automationSteps(Array.from({ length: 201 }, () => ({ action: 'home', delayMs: 0 })))).toThrow(
      '0 to 200'
    )
  })
})

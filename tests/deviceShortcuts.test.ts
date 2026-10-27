import type { Input } from 'electron'
import { describe, expect, it } from 'vitest'
import { deviceShortcut } from '../src/main/deviceShortcuts'

const input = (overrides: Partial<Input> = {}): Input => ({
  type: 'keyDown', key: 'C', code: 'KeyC', shift: true, alt: false, control: false,
  meta: true, isAutoRepeat: false, isComposing: false, location: 0, modifiers: [], ...overrides
})

describe('focused application device shortcuts', () => {
  it('maps screenshot and control shortcuts', () => {
    expect(deviceShortcut(input())).toEqual({ channel: 'app:screenshot-shortcut', action: 'copy' })
    expect(deviceShortcut(input({ key: 's' }))).toEqual({ channel: 'app:screenshot-shortcut', action: 'save' })
    expect(deviceShortcut(input({ key: 'r', alt: true, shift: false })))
      .toEqual({ channel: 'app:control-shortcut', action: 'auto-rotate' })
    expect(deviceShortcut(input({ key: 't', alt: true, shift: false }))?.action).toBe('show-touches-on')
    expect(deviceShortcut(input({ key: 't', alt: true }))?.action).toBe('show-touches-off')
  })

  it.each<Partial<Input>>([
    { type: 'keyUp' }, { isAutoRepeat: true }, { isComposing: true }, { meta: false }, { control: true },
    { alt: true }, { shift: false }, { key: 'x' }
  ])('leaves other input untouched: %j', (overrides) => {
    expect(deviceShortcut(input(overrides))).toBeUndefined()
  })
})

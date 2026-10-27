import type { Input } from 'electron'
import type { DeviceControlAction } from '../shared/types'

type DeviceShortcut = { channel: 'app:screenshot-shortcut'; action: 'save' | 'copy' }
  | { channel: 'app:control-shortcut'; action: DeviceControlAction }

export function deviceShortcut(input: Input): DeviceShortcut | undefined {
  if (input.type !== 'keyDown' || input.isAutoRepeat || input.isComposing || !input.meta || input.control) return
  const key = input.key.toLowerCase()
  if (input.shift && !input.alt && (key === 's' || key === 'c')) {
    return { channel: 'app:screenshot-shortcut', action: key === 's' ? 'save' : 'copy' }
  }
  if (input.alt && key === 'r' && !input.shift) return { channel: 'app:control-shortcut', action: 'auto-rotate' }
  if (input.alt && key === 't') {
    return { channel: 'app:control-shortcut', action: input.shift ? 'show-touches-off' : 'show-touches-on' }
  }
}
